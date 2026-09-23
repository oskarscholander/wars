import type { DiffFile } from "@ww/shared";
import { worktreeDiff } from "./git/diff.ts";
import type { Store } from "./store.ts";

/** Computes a front's diff and publishes it as `diff.updated`. */
export class Diffs {
  constructor(private store: Store) {}

  async refresh(frontId: string): Promise<DiffFile[]> {
    const front = this.store.state.fronts[frontId];
    const repo = front && this.store.state.repos[front.repoId];
    if (!front || !repo) return [];
    const files = await worktreeDiff(front.path, repo.path);
    if (this.store.state.fronts[frontId]) this.store.emit({ type: "diff.updated", frontId, files });
    return files;
  }
}
