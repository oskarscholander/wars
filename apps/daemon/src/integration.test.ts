import { request } from "node:http";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ServerEvent, WarState } from "@ww/shared";
import { applyEvent, emptyState } from "@ww/shared";
import { Discovery } from "./discovery.ts";
import { branchSlug, createWorktree, worktreePathFor } from "./git/createWorktree.ts";
import { buildServer } from "./server.ts";
import { Store } from "./store.ts";
import { Db } from "./db.ts";
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

describe("daemon over WebSocket", () => {
  it("rejects a missing token and snapshots, then streams new fronts", async () => {
    const store = new Store();
    const discovery = new Discovery({ repoPath: repo, store, intervalMs: 60_000, log: () => {} });
    await discovery.start();
    const config = { repoPath: repo, testCommand: ["true"] as [string], defaultModel: "sonnet" as const, port: 0 };
    const permissions = new PermissionQueue(store);
    const units = new UnitManager({
      store,
      db: new Db(":memory:"),
      permissions,
      queryFn: () => (async function* () {})(),
      changedFiles: async () => 0,
    });
    const app = await buildServer({ config, store, discovery, units, permissions, token: "secret" });
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

      ws.send(JSON.stringify({ type: "front.create", branch: "feat/two" }));
      await expect.poll(() => Object.values(state.fronts).map((f) => f.branch)).toContain("feat/two");
      expect(events[0]?.type).toBe("state.snapshot");
      expect(state).toEqual(store.state);

      ws.send(JSON.stringify({ type: "front.create", branch: "bad..name" }));
      await expect.poll(() => events.at(-1)).toMatchObject({ type: "error", command: "front.create" });
      ws.close();
    } finally {
      discovery.stop();
      await app.close();
    }
  });

  it("picks up worktrees created outside the daemon via the watcher", async () => {
    const store = new Store();
    const discovery = new Discovery({ repoPath: repo, store, intervalMs: 60_000, log: () => {} });
    await discovery.start();
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
      discovery.stop();
    }
  });
});
