import { request } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerEvent, WarState } from "@ww/shared";
import { applyEvent, emptyState } from "@ww/shared";
import { RepoManager } from "./repos.ts";
import { detectTestCommand, findRepos, resolveRepoRoot } from "./git/repos.ts";
import { worktreeCreatedAt } from "./git/worktrees.ts";
import { branchSlug, createWorktree, worktreePathFor } from "./git/createWorktree.ts";
import { buildServer } from "./server.ts";
import { Store } from "./store.ts";
import { Db } from "./db.ts";
import { Diffs } from "./diffs.ts";
import { Shipping } from "./shipping/shipping.ts";
import { worktreeDiff } from "./git/diff.ts";
import { writeFile } from "node:fs/promises";
import { UnitManager } from "./units/manager.ts";
import { PermissionQueue } from "./units/permissions.ts";

let root: string;
let repo: string;

const git = (...args: string[]) => execa("git", ["-C", repo, ...args]);

beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "ww-")));
  repo = join(root, "app");
  await execa("git", ["init", "-q", "-b", "main", repo]);
  await git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init");
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("createWorktree", () => {
  it("slugs branch names into sibling paths", () => {
    expect(branchSlug("feat/tiptap comments")).toBe("feat-tiptap-comments");
    expect(worktreePathFor("/src/app", "fix/x")).toBe("/src/app-fix-x");
  });

  it("creates a new branch worktree next to the repo", async () => {
    const path = await createWorktree(repo, "feat/one");
    expect(path).toBe(join(root, "app-feat-one"));
    const { stdout } = await git("worktree", "list", "--porcelain");
    expect(stdout).toContain("branch refs/heads/feat/one");
  });

  it("reuses an existing branch", async () => {
    await git("branch", "existing");
    await expect(createWorktree(repo, "existing")).resolves.toBe(join(root, "app-existing"));
  });

  it("rejects invalid and option-like branch names", async () => {
    await expect(createWorktree(repo, "bad..name")).rejects.toThrow(/not a valid branch/);
    await expect(createWorktree(repo, "--force")).rejects.toThrow(/not a valid branch/);
  });
});

const repoManager = (store: Store, db = new Db(":memory:")) =>
  new RepoManager({ store, db, intervalMs: 60_000, scanRoots: [root], log: () => {} });

describe("daemon over WebSocket", () => {
  it("rejects a missing token, suggests and adds repos, then streams new fronts", async () => {
    const store = new Store();
    const db = new Db(":memory:");
    const repos = repoManager(store, db);
    await repos.start();
    const config = { defaultModel: "sonnet" as const, port: 0 };
    const permissions = new PermissionQueue(store);
    const units = new UnitManager({
      store,
      db,
      permissions,
      queryFn: () => (async function* () {})(),
      changedFiles: async () => 0,
    });
    const app = await buildServer({ config, store, repos, units, permissions, diffs: new Diffs(store), shipping: new Shipping({ store }), token: "secret" });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const { port } = app.server.address() as { port: number };

    try {
      const status = (token?: string) =>
        new Promise<number>((resolve) => {
          const req = request(`http://127.0.0.1:${port}/ws${token ? `?token=${token}` : ""}`, {
            headers: {
              connection: "upgrade",
              upgrade: "websocket",
              "sec-websocket-version": "13",
              "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
            },
          });
          req.on("response", (res) => resolve(res.statusCode ?? 0));
          req.on("upgrade", (_res, socket) => (socket.destroy(), resolve(101)));
          req.end();
        });
      expect(await status()).toBe(401);
      expect(await status("wrong")).toBe(401);

      let state: WarState = emptyState();
      const events: ServerEvent[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=secret`);
      ws.onmessage = (m) => {
        const ev = JSON.parse(String(m.data)) as ServerEvent;
        events.push(ev);
        state = applyEvent(state, ev);
      };
      await new Promise((r) => (ws.onopen = r));

      ws.send(JSON.stringify({ type: "repo.suggest" }));
      await expect.poll(() => events.find((e) => e.type === "repo.suggestions")).toMatchObject({
        suggestions: expect.arrayContaining([{ path: repo, name: "app" }]),
      });

      // Adding by a path inside a linked worktree resolves to the main repo.
      ws.send(JSON.stringify({ type: "repo.add", path: join(root, "app-feat-one") }));
      await expect.poll(() => Object.values(state.repos).map((r) => r.path)).toEqual([repo]);
      const repoId = Object.keys(state.repos)[0]!;
      await expect.poll(() => Object.values(state.fronts).map((f) => f.branch)).toContain("feat/one");

      ws.send(JSON.stringify({ type: "front.create", repoId, branch: "feat/two" }));
      await expect.poll(() => Object.values(state.fronts).map((f) => f.branch)).toContain("feat/two");
      expect(events[0]?.type).toBe("state.snapshot");
      expect(state).toEqual(store.state);

      ws.send(JSON.stringify({ type: "front.create", repoId, branch: "bad..name" }));
      await expect.poll(() => events.at(-1)).toMatchObject({ type: "error", command: "front.create" });
      ws.close();
    } finally {
      repos.stop();
      await app.close();
    }
  });

  it("picks up worktrees created outside the daemon via the watcher", async () => {
    const store = new Store();
    const repos = repoManager(store);
    await repos.add(repo);
    try {
      await git("worktree", "add", "-q", "-b", "outside", join(root, "app-outside"));
      await expect
        .poll(() => Object.values(store.state.fronts).map((f) => f.branch), { timeout: 3000 })
        .toContain("outside");
      await git("worktree", "remove", join(root, "app-outside"));
      await expect
        .poll(() => Object.values(store.state.fronts).map((f) => f.branch), { timeout: 3000 })
        .not.toContain("outside");
    } finally {
      repos.stop();
    }
  });
});

describe("worktreeDiff", () => {
  it("includes committed, unstaged and untracked changes since the branch forked", async () => {
    const wt = await createWorktree(repo, "feat/diffed");
    const g = (...args: string[]) => execa("git", ["-C", wt, "-c", "user.email=t@t", "-c", "user.name=t", ...args]);
    await writeFile(join(wt, "committed.ts"), "one\ntwo\n");
    await g("add", "committed.ts");
    await g("commit", "-q", "-m", "work");
    await writeFile(join(wt, "committed.ts"), "one\nTWO\n");
    await writeFile(join(wt, "fresh.txt"), "hello\n");

    const files = await worktreeDiff(wt, repo);
    expect(files.map((f) => f.path)).toEqual(["committed.ts", "fresh.txt"]);
    expect(files[0]).toMatchObject({ added: 2, removed: 0 });
    expect(files[1]).toMatchObject({ added: 1, removed: 0 });
    expect(files[1]!.hunks[0]!.lines[0]).toEqual({ kind: "add", text: "hello", oldLine: null, newLine: 1 });
    // Nothing was staged on the user's behalf.
    expect((await g("status", "--porcelain")).stdout).toContain("?? fresh.txt");
  });
});

describe("repos", () => {
  it("resolves any folder in a repo or its worktrees to the main worktree", async () => {
    await expect(resolveRepoRoot(repo)).resolves.toBe(repo);
    await expect(resolveRepoRoot(join(root, "app-feat-one"))).resolves.toBe(repo);
    await expect(resolveRepoRoot(root)).rejects.toThrow(/not inside a git repository/);
    await expect(resolveRepoRoot(join(root, "missing"))).rejects.toThrow(/not a folder/);
  });

  it("suggests main worktrees only, including repos named like build folders", async () => {
    const found = await findRepos([root]);
    expect(found.map((f) => f.path)).toEqual([repo]);
    const named = join(root, "nest", "target");
    await execa("git", ["init", "-q", named]);
    await execa("git", ["init", "-q", join(root, "nest", "node_modules", "dep")]);
    expect((await findRepos([root])).map((f) => f.path)).toEqual([repo, named]);
    await rm(join(root, "nest"), { recursive: true, force: true });
  });

  it("detects test commands from project files", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "ww-detect-")));
    try {
      expect(await detectTestCommand(dir)).toBeNull();
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }));
      expect(await detectTestCommand(dir)).toBeNull();
      await writeFile(join(dir, "package.json"), JSON.stringify({ scripts: { test: "vitest" } }));
      expect(await detectTestCommand(dir)).toEqual(["npm", "test"]);
      await writeFile(join(dir, "pnpm-lock.yaml"), "");
      expect(await detectTestCommand(dir)).toEqual(["pnpm", "test"]);
      await rm(join(dir, "package.json"));
      await writeFile(join(dir, "go.mod"), "module x");
      expect(await detectTestCommand(dir)).toEqual(["go", "test", "./..."]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("persists monitored repos, dedupes, and drops fronts on removal", async () => {
    const db = new Db(":memory:");
    const store = new Store();
    const first = repoManager(store, db);
    const added = await first.add(repo);
    expect(await first.add(join(root, "app-feat-one"))).toEqual(added);
    expect(added.testCommand).toEqual([]);
    expect(Object.keys(store.state.fronts).length).toBeGreaterThan(0);
    first.stop();

    const again = new Store();
    const second = repoManager(again, db);
    await second.start();
    expect(Object.keys(again.state.repos)).toEqual([added.id]);
    second.remove(added.id);
    expect(again.state.repos).toEqual({});
    expect(again.state.fronts).toEqual({});
    expect(db.listRepos()).toEqual([]);
    second.stop();
  });
});

describe("worktreeCreatedAt", () => {
  it("reads when a linked worktree was created, and null for anything else", async () => {
    const before = Date.now() - 5_000;
    const wt = await createWorktree(repo, "feat/aged");
    const at = await worktreeCreatedAt(wt);
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThan(before);
    expect(at!).toBeLessThanOrEqual(Date.now() + 1_000);
    await expect(worktreeCreatedAt(repo)).resolves.toBeNull();
    await expect(worktreeCreatedAt(join(root, "missing"))).resolves.toBeNull();
  });

  it("fills createdAt on discovered fronts", async () => {
    const store = new Store();
    const repos = repoManager(store);
    await repos.add(repo);
    try {
      const aged = Object.values(store.state.fronts).find((f) => f.branch === "feat/aged");
      expect(aged?.createdAt).toBeGreaterThan(0);
    } finally {
      repos.stop();
    }
  });
});
