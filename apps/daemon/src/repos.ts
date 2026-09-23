import { basename } from "node:path";
import type { Repo, RepoSuggestion } from "@ww/shared";
import type { Db } from "./db.ts";
import { Discovery } from "./discovery.ts";
import { defaultScanRoots, detectTestCommand, findRepos, RepoError, resolveRepoRoot } from "./git/repos.ts";
import { frontIdFor } from "./git/worktrees.ts";
import type { Store } from "./store.ts";

export interface RepoManagerOptions {
  store: Store;
  db: Db;
  /** Used when a repo's test command can't be detected. */
  defaultTestCommand?: string[];
  scanRoots?: string[];
  intervalMs?: number;
  log?: (msg: string) => void;
}

/** The repos the user monitors: persisted, one worktree watcher each. */
export class RepoManager {
  #o: RepoManagerOptions;
  #discoveries = new Map<string, Discovery>();

  constructor(opts: RepoManagerOptions) {
    this.#o = opts;
  }

  /** Restores saved repos. A repo that has gone missing is kept but skipped, with a log line. */
  async start(): Promise<void> {
    for (const saved of this.#o.db.listRepos()) {
      try {
        await this.#watch({ id: saved.id, path: saved.path, name: basename(saved.path), testCommand: saved.testCommand });
      } catch (err) {
        this.#o.log?.(`skipping ${saved.path}: ${err instanceof Error ? err.message : err}`);
      }
    }
  }

  async add(path: string): Promise<Repo> {
    const root = await resolveRepoRoot(path);
    const id = frontIdFor(root);
    const existing = this.#o.store.state.repos[id];
    if (existing) return existing;
    const testCommand = (await detectTestCommand(root)) ?? this.#o.defaultTestCommand ?? [];
    const repo: Repo = { id, path: root, name: basename(root), testCommand };
    this.#o.db.saveRepo(repo);
    await this.#watch(repo);
    return repo;
  }

  remove(repoId: string): void {
    if (!this.#o.store.state.repos[repoId]) throw new RepoError("That repo is not monitored");
    this.#discoveries.get(repoId)?.stop();
    this.#discoveries.delete(repoId);
    this.#o.db.deleteRepo(repoId);
    this.#o.store.emit({ type: "repo.removed", repoId });
  }

  updateTestCommand(repoId: string, testCommand: string[]): void {
    const repo = this.#o.store.state.repos[repoId];
    if (!repo) throw new RepoError("That repo is not monitored");
    const next = { ...repo, testCommand };
    this.#o.db.saveRepo(next);
    this.#o.store.emit({ type: "repo.upserted", repo: next });
  }

  /** Git repos under the usual code folders that aren't monitored yet. */
  async suggest(): Promise<RepoSuggestion[]> {
    const monitored = new Set(Object.values(this.#o.store.state.repos).map((r) => r.path));
    const found = await findRepos(this.#o.scanRoots ?? defaultScanRoots());
    return found.filter((s) => !monitored.has(s.path));
  }

  /** Refreshes one repo's worktrees now, e.g. right after creating one. */
  refresh(repoId: string): Promise<void> {
    return this.#discoveries.get(repoId)?.refresh() ?? Promise.resolve();
  }

  stop(): void {
    for (const d of this.#discoveries.values()) d.stop();
    this.#discoveries.clear();
  }

  async #watch(repo: Repo): Promise<void> {
    const discovery = new Discovery({
      repoId: repo.id,
      repoPath: repo.path,
      store: this.#o.store,
      ...(this.#o.intervalMs ? { intervalMs: this.#o.intervalMs } : {}),
      ...(this.#o.log ? { log: this.#o.log } : {}),
    });
    this.#o.store.emit({ type: "repo.upserted", repo });
    this.#discoveries.set(repo.id, discovery);
    try {
      await discovery.start();
    } catch (err) {
      discovery.stop();
      this.#discoveries.delete(repo.id);
      this.#o.store.emit({ type: "repo.removed", repoId: repo.id });
      throw err;
    }
  }
}

export { RepoError };
