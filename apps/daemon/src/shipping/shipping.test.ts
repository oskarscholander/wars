import { describe, expect, it } from "vitest";
import type { TestsState } from "@ww/shared";
import { storeWithFront, TEST_REPO, tick } from "../units/testkit.ts";
import { Shipping, type RunResult, type Runner } from "./shipping.ts";

type Call = { cmd: string; args: string[]; cwd: string };

function fakeRunner(responses: Record<string, Partial<RunResult>>) {
  const calls: Call[] = [];
  const run: Runner = async (cmd, args, { cwd }) => {
    calls.push({ cmd, args, cwd });
    const key = Object.keys(responses).find((k) => `${cmd} ${args.join(" ")}`.startsWith(k));
    const r = key ? responses[key]! : { exitCode: 0 };
    const stdout = r.stdout ?? "";
    const stderr = r.stderr ?? "";
    return { exitCode: r.exitCode ?? 0, stdout, stderr, all: r.all ?? stdout + stderr };
  };
  return { run, calls };
}

const failing: TestsState = { status: "failed", passed: 0, failed: 1, outputTail: "" };

describe("Shipping.runTests", () => {
  it("runs the test command in the worktree and raises the bunker on failure", async () => {
    const store = storeWithFront();
    const { run, calls } = fakeRunner({ pnpm: { exitCode: 1, stdout: "Tests  1 failed | 4 passed (5)" } });
    const saved: TestsState[] = [];
    const s = new Shipping({ store, run, saveTests: (_, t) => saved.push(t) });
    const statuses: string[] = [];
    store.subscribe((ev) => ev.type === "tests.result" && statuses.push(ev.tests.status));

    const tests = await s.runTests("f1");
    expect(calls[0]).toEqual({ cmd: "pnpm", args: ["test"], cwd: "/tmp/f1" });
    expect(statuses).toEqual(["running", "failed"]);
    expect(tests).toMatchObject({ status: "failed", passed: 4, failed: 1 });
    expect(store.state.fronts.f1?.tests.status).toBe("failed");
    expect(saved).toHaveLength(1);
  });

  it("counts a non-zero exit with no summary as one failure", async () => {
    const { run } = fakeRunner({ make: { exitCode: 2, stdout: "boom" } });
    const store = storeWithFront();
    store.emit({ type: "repo.upserted", repo: { ...TEST_REPO, testCommand: ["make", "check"] } });
    const s = new Shipping({ store, run });
    await expect(s.runTests("f1")).resolves.toMatchObject({ status: "failed", failed: 1, outputTail: "boom" });
  });

  it("asks for a test command when the repo has none", async () => {
    const store = storeWithFront();
    store.emit({ type: "repo.upserted", repo: { ...TEST_REPO, testCommand: [] } });
    await expect(new Shipping({ store, run: fakeRunner({}).run }).runTests("f1")).rejects.toThrow(/No test command/);
    expect(store.state.fronts.f1?.tests.status).toBe("unknown");
  });

  it("restores saved results for fronts that appear", async () => {
    const store = storeWithFront();
    new Shipping({ store, run: fakeRunner({}).run, loadTests: () => failing });
    expect(store.state.fronts.f1?.tests.status).toBe("failed");
  });
});

describe("Shipping PRs", () => {
  it("refuses to open a PR while tests fail", async () => {
    const store = storeWithFront();
    store.emit({ type: "tests.result", frontId: "f1", tests: failing });
    const { run, calls } = fakeRunner({});
    await expect(new Shipping({ store, run }).openPr("f1")).rejects.toThrow(/bunker/);
    expect(calls).toEqual([]);
  });

  it("pushes, creates the PR and raises the gold flag", async () => {
    const store = storeWithFront();
    const { run, calls } = fakeRunner({ "gh pr create": { stdout: "https://github.com/o/r/pull/7\n" } });
    const pr = await new Shipping({ store, run }).openPr("f1");
    expect(calls.map((c) => [c.cmd, ...c.args].join(" "))).toEqual([
      "git push -u origin feat/f1",
      "gh pr create --fill --head feat/f1",
    ]);
    expect(pr).toEqual({ number: 7, url: "https://github.com/o/r/pull/7", state: "open" });
    expect(store.state.fronts.f1?.pr?.state).toBe("open");
  });

  it("adopts an existing PR when gh says one already exists", async () => {
    const store = storeWithFront();
    const { run } = fakeRunner({
      "gh pr create": { exitCode: 1, stderr: 'a pull request for branch "feat/f1" into branch "main" already exists:\nhttps://github.com/o/r/pull/9' },
    });
    await expect(new Shipping({ store, run }).openPr("f1")).resolves.toMatchObject({ number: 9 });
  });

  it("reports push failures", async () => {
    const { run } = fakeRunner({ "git push": { exitCode: 128, stderr: "fatal: no remote 'origin'" } });
    await expect(new Shipping({ store: storeWithFront(), run }).openPr("f1")).rejects.toThrow(/no remote/);
  });

  it("merges an open PR and wins the island", async () => {
    const store = storeWithFront();
    store.emit({ type: "pr.opened", frontId: "f1", number: 7, url: "u" });
    const { run, calls } = fakeRunner({});
    await new Shipping({ store, run }).mergePr("f1");
    expect(calls[0]?.args).toEqual(["pr", "merge", "7", "--squash"]);
    expect(store.state.fronts.f1?.pr?.state).toBe("merged");
  });

  it("polls PR state from gh", async () => {
    const store = storeWithFront();
    let view: Partial<RunResult> = { exitCode: 1, stderr: 'no pull requests found for branch "feat/f1"' };
    const run: Runner = async () => ({ exitCode: view.exitCode ?? 0, stdout: view.stdout ?? "", stderr: view.stderr ?? "", all: (view.stdout ?? "") + (view.stderr ?? "") });
    const s = new Shipping({ store, run });

    await s.pollPr("f1");
    expect(store.state.fronts.f1?.pr).toBeNull();
    view = { stdout: '{"number":5,"state":"OPEN","url":"u5"}' };
    await s.pollPr("f1");
    expect(store.state.fronts.f1?.pr).toEqual({ number: 5, url: "u5", state: "open" });
    view = { stdout: '{"number":5,"state":"MERGED","url":"u5"}' };
    await s.pollPr("f1");
    expect(store.state.fronts.f1?.pr?.state).toBe("merged");
    // Network trouble keeps what we know.
    view = { exitCode: 1, stderr: "error connecting to api.github.com" };
    await s.pollPr("f1");
    expect(store.state.fronts.f1?.pr?.state).toBe("merged");
  });

  it("stops polling when gh is not installed", async () => {
    let calls = 0;
    const run: Runner = async () => (calls++, { exitCode: 1, stdout: "", stderr: "gh: spawn gh ENOENT", all: "gh: spawn gh ENOENT" });
    const s = new Shipping({ store: storeWithFront(), run, log: () => {} });
    await s.pollPr("f1");
    await s.pollPr("f1");
    await tick();
    expect(calls).toBe(1);
  });
});
