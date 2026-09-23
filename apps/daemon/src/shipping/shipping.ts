import { execa } from "execa";
import type { Front, PrState, TestsState } from "@ww/shared";
import type { Store } from "../store.ts";
import { parsePrUrl, parsePrView, parseTestCounts, tail } from "./parse.ts";

export interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** stdout and stderr interleaved. */
  all: string;
}

/** Runs a command with an argument array (never a shell string). */
export type Runner = (cmd: string, args: string[], opts: { cwd: string; timeoutMs?: number }) => Promise<RunResult>;

export const execaRunner: Runner = async (cmd, args, { cwd, timeoutMs }) => {
  const r = await execa(cmd, args, { cwd, all: true, reject: false, timeout: timeoutMs, stdin: "ignore" });
  const code = typeof r.exitCode === "number" ? r.exitCode : r.timedOut ? 124 : 1;
  const missing = r.failed && r.exitCode === undefined ? `${cmd}: ${r.shortMessage}` : "";
  return { exitCode: code, stdout: r.stdout ?? "", stderr: (r.stderr ?? "") + missing, all: (r.all ?? "") + missing };
};

export class ShippingError extends Error {}

export interface ShippingOptions {
  store: Store;
  testCommand: [string, ...string[]];
  run?: Runner;
  /** Persist test results so bunkers survive a daemon restart. */
  saveTests?: (frontId: string, tests: TestsState) => void;
  loadTests?: (frontId: string) => TestsState | null;
  log?: (msg: string) => void;
}

const TEST_TIMEOUT_MS = 15 * 60_000;

/** Tests, PRs and merges for a front. Every command is an execa argument array. */
export class Shipping {
  #o: Required<Omit<ShippingOptions, "saveTests" | "loadTests">> & Pick<ShippingOptions, "saveTests" | "loadTests">;
  #testing = new Set<string>();
  #busy = new Set<string>();
  #ghMissing = false;

  constructor(opts: ShippingOptions) {
    this.#o = { run: execaRunner, log: console.log, ...opts };
    const restore = (frontId: string) => {
      const front = this.#o.store.state.fronts[frontId];
      const saved = front?.tests.status === "unknown" ? this.#o.loadTests?.(frontId) : null;
      if (saved) this.#o.store.emit({ type: "tests.result", frontId, tests: saved });
    };
    // Deferred so the restored result reaches clients after the front itself.
    opts.store.subscribe((ev) => ev.type === "front.upserted" && queueMicrotask(() => restore(ev.front.id)));
    for (const id of Object.keys(opts.store.state.fronts)) restore(id);
  }

  #front(frontId: string): Front {
    const f = this.#o.store.state.fronts[frontId];
    if (!f) throw new ShippingError("That front no longer exists");
    return f;
  }

  #setTests(frontId: string, tests: TestsState): void {
    this.#o.store.emit({ type: "tests.result", frontId, tests });
    if (tests.status !== "running") this.#o.saveTests?.(frontId, tests);
  }

  /** Runs the configured test command in the worktree; failing tests raise the bunker. */
  async runTests(frontId: string): Promise<TestsState> {
    const front = this.#front(frontId);
    if (this.#testing.has(frontId)) throw new ShippingError("Tests are already running on this front");
    this.#testing.add(frontId);
    const previous = front.tests;
    this.#setTests(frontId, { ...previous, status: "running" });
    try {
      const [cmd, ...args] = this.#o.testCommand;
      const r = await this.#o.run(cmd, args, { cwd: front.path, timeoutMs: TEST_TIMEOUT_MS });
      const counts = parseTestCounts(r.all);
      const tests: TestsState = {
        status: r.exitCode === 0 ? "passed" : "failed",
        passed: counts.passed,
        // A non-zero exit with no parsable failures still counts as one failure.
        failed: r.exitCode !== 0 && counts.failed === 0 ? 1 : counts.failed,
        outputTail: tail(r.all),
      };
      if (this.#o.store.state.fronts[frontId]) this.#setTests(frontId, tests);
      return tests;
    } catch (err) {
      if (this.#o.store.state.fronts[frontId]) this.#setTests(frontId, previous);
      throw err;
    } finally {
      this.#testing.delete(frontId);
    }
  }

  /** `git push -u origin <branch>` then `gh pr create --fill`. Blocked while tests fail. */
  async openPr(frontId: string): Promise<PrState> {
    const front = this.#front(frontId);
    if (!front.branch) throw new ShippingError("Detached HEAD: check out a branch before opening a PR");
    if (front.tests.status === "failed") throw new ShippingError("A failing-test bunker blocks the road. Run the tests first.");
    if (front.tests.status === "running") throw new ShippingError("Wait for the test run to finish");
    if (front.pr?.state === "open") return front.pr;
    return this.#exclusive(frontId, async () => {
      const push = await this.#o.run("git", ["push", "-u", "origin", front.branch!], { cwd: front.path });
      if (push.exitCode !== 0) throw new ShippingError(`git push failed: ${lastLine(push.all)}`);

      const create = await this.#o.run("gh", ["pr", "create", "--fill", "--head", front.branch!], { cwd: front.path });
      let pr = create.exitCode === 0 ? parsePrUrl(create.stdout) : null;
      // "a pull request for branch ... already exists: <url>"
      if (!pr && /already exists/i.test(create.all)) pr = parsePrUrl(create.all);
      if (!pr) throw new ShippingError(`gh pr create failed: ${lastLine(create.all)}`);

      this.#o.store.emit({ type: "pr.opened", frontId, number: pr.number, url: pr.url });
      return { ...pr, state: "open" as const };
    });
  }

  /** `gh pr merge <n> --squash`; the island is won. */
  async mergePr(frontId: string): Promise<void> {
    const front = this.#front(frontId);
    if (!front.pr || front.pr.state !== "open") throw new ShippingError("There is no open PR on this front");
    const pr = front.pr;
    await this.#exclusive(frontId, async () => {
      const r = await this.#o.run("gh", ["pr", "merge", String(pr.number), "--squash"], { cwd: front.path });
      if (r.exitCode !== 0) throw new ShippingError(`gh pr merge failed: ${lastLine(r.all)}`);
      this.#o.store.emit({ type: "pr.merged", frontId });
    });
  }

  /** Refreshes one front's PR from `gh pr view`. Quietly gives up if gh is not installed. */
  async pollPr(frontId: string): Promise<void> {
    if (this.#ghMissing || this.#busy.has(frontId)) return;
    const front = this.#o.store.state.fronts[frontId];
    if (!front?.branch) return;
    const r = await this.#o.run("gh", ["pr", "view", front.branch, "--json", "number,state,url"], { cwd: front.path });
    if (/ENOENT|command not found|not found: gh/i.test(r.stderr) && r.exitCode !== 0 && !r.stdout) {
      this.#ghMissing = true;
      this.#o.log("gh not found: PR polling disabled");
      return;
    }
    const current = this.#o.store.state.fronts[frontId];
    if (!current) return;
    const pr = r.exitCode === 0 ? parsePrView(r.stdout) : null;
    if (r.exitCode !== 0 && !/no pull requests found/i.test(r.all)) return; // auth or network trouble: keep what we know
    if (samePr(current.pr, pr)) return;
    if (pr?.state === "open") this.#o.store.emit({ type: "pr.opened", frontId, number: pr.number, url: pr.url });
    else if (pr?.state === "merged" && current.pr?.number === pr.number) this.#o.store.emit({ type: "pr.merged", frontId });
    else this.#o.store.emit({ type: "front.upserted", front: { ...current, pr } });
  }

  async pollAll(): Promise<void> {
    for (const id of Object.keys(this.#o.store.state.fronts)) await this.pollPr(id);
  }

  async #exclusive<T>(frontId: string, fn: () => Promise<T>): Promise<T> {
    if (this.#busy.has(frontId)) throw new ShippingError("Another PR action is in progress on this front");
    this.#busy.add(frontId);
    try {
      return await fn();
    } finally {
      this.#busy.delete(frontId);
    }
  }
}

const samePr = (a: PrState | null, b: PrState | null) =>
  a === b || (!!a && !!b && a.number === b.number && a.state === b.state && a.url === b.url);

const lastLine = (s: string) => s.trim().split("\n").at(-1) || "no output";
