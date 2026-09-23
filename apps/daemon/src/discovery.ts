import { watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { emptyTests, type Front, type ServerEvent } from "@ww/shared";
import { frontIdFor, gitCommonDir, linkedWorktrees, listWorktrees, worktreeCreatedAt, type Worktree } from "./git/worktrees.ts";
import type { Store } from "./store.ts";

const sameGitInfo = (a: Front, b: Front) =>
  a.path === b.path &&
  a.branch === b.branch &&
  a.head === b.head &&
  a.locked === b.locked &&
  a.prunable === b.prunable &&
  a.createdAt === b.createdAt;

/**
 * Turns a fresh worktree listing into the events that bring `current` up to date.
 * Tests and PR state on existing fronts are kept; only git facts are refreshed.
 */
export function diffFronts(current: Record<string, Front>, trees: Worktree[], repoId: string): ServerEvent[] {
  const events: ServerEvent[] = [];
  const mine = Object.values(current).filter((f) => f.repoId === repoId);
  const seen = new Set<string>();
  for (const t of linkedWorktrees(trees)) {
    const id = frontIdFor(t.path);
    seen.add(id);
    const prev = current[id];
    const git = {
      path: t.path,
      branch: t.branch,
      head: t.head,
      locked: t.locked,
      prunable: t.prunable,
      createdAt: t.createdAt ?? prev?.createdAt ?? null,
    };
    const next: Front = prev ? { ...prev, ...git } : { id, repoId, ...git, tests: emptyTests(), pr: null };
    if (!prev || !sameGitInfo(prev, next)) events.push({ type: "front.upserted", front: next });
  }
  for (const f of mine) {
    if (!seen.has(f.id)) events.push({ type: "front.removed", frontId: f.id });
  }
  return events;
}

export interface DiscoveryOptions {
  repoId: string;
  repoPath: string;
  store: Store;
  intervalMs?: number;
  log?: (msg: string) => void;
}

/** Polls one repo's `git worktree list` and watches `.git/worktrees/` for immediate refreshes. */
export class Discovery {
  #opts: Required<DiscoveryOptions>;
  #timer: NodeJS.Timeout | null = null;
  #debounce: NodeJS.Timeout | null = null;
  #watchers = new Map<string, FSWatcher>();
  #commonDir: string | null = null;
  #running: Promise<void> | null = null;
  #again = false;
  #lastError = "";

  constructor(opts: DiscoveryOptions) {
    this.#opts = { intervalMs: 5000, log: console.log, ...opts };
  }

  async start(): Promise<void> {
    this.#commonDir = await gitCommonDir(this.#opts.repoPath);
    await this.refresh();
    this.#timer = setInterval(() => void this.refresh(), this.#opts.intervalMs);
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    if (this.#debounce) clearTimeout(this.#debounce);
    for (const w of this.#watchers.values()) w.close();
    this.#watchers.clear();
  }

  /** Serialized: a refresh requested mid-run triggers exactly one more run. */
  refresh(): Promise<void> {
    if (this.#running) {
      this.#again = true;
      return this.#running;
    }
    this.#running = (async () => {
      do {
        this.#again = false;
        await this.#refreshOnce();
      } while (this.#again);
    })().finally(() => {
      this.#running = null;
    });
    return this.#running;
  }

  async #refreshOnce(): Promise<void> {
    try {
      const trees = await listWorktrees(this.#opts.repoPath);
      // Creation time never changes, so only look it up for worktrees we haven't seen.
      await Promise.all(
        linkedWorktrees(trees).map(async (t) => {
          const known = this.#opts.store.state.fronts[frontIdFor(t.path)];
          t.createdAt = known?.createdAt ?? (await worktreeCreatedAt(t.path));
        }),
      );
      if (!this.#opts.store.state.repos[this.#opts.repoId]) return;
      for (const ev of diffFronts(this.#opts.store.state.fronts, trees, this.#opts.repoId)) this.#opts.store.emit(ev);
      this.#lastError = "";
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg !== this.#lastError) this.#opts.log(`worktree discovery failed: ${msg}`);
      this.#lastError = msg;
    }
    this.#ensureWatchers();
  }

  /** Watch the common git dir (sees `worktrees/` appear) and `worktrees/` itself once it exists. */
  #ensureWatchers(): void {
    if (!this.#commonDir) return;
    for (const dir of [this.#commonDir, join(this.#commonDir, "worktrees")]) {
      if (this.#watchers.has(dir)) continue;
      try {
        const w = watch(dir, () => this.#schedule());
        w.on("error", () => {
          w.close();
          this.#watchers.delete(dir);
        });
        this.#watchers.set(dir, w);
      } catch {
        // Directory does not exist yet; retried on the next refresh.
      }
    }
  }

  #schedule(): void {
    if (this.#debounce) clearTimeout(this.#debounce);
    this.#debounce = setTimeout(() => void this.refresh(), 150);
  }
}
