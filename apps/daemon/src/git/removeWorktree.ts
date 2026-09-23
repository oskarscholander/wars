import { execa } from "execa";

export class RemoveError extends Error {
  constructor(
    message: string,
    readonly code?: "dirty" | "locked",
  ) {
    super(message);
  }
}

export interface RemoveResult {
  branchDeleted: boolean;
  /** Why the branch was kept, when it was asked to be deleted. */
  branchNote?: string;
}

/**
 * `git worktree remove <path>` (with `--force` to discard uncommitted work), then
 * optionally `git branch -d <branch>`, which refuses unmerged branches so work
 * that only exists on the branch is never lost.
 */
export async function removeWorktree(
  repoPath: string,
  worktreePath: string,
  opts: { force?: boolean; branch?: string | null; deleteBranch?: boolean } = {},
): Promise<RemoveResult> {
  const args = ["-C", repoPath, "worktree", "remove", ...(opts.force ? ["--force"] : []), "--", worktreePath];
  const r = await execa("git", args, { reject: false });
  if (r.exitCode !== 0) {
    const err = r.stderr.trim();
    if (/locked working tree/i.test(err)) {
      throw new RemoveError("This worktree is locked. Unlock it with git worktree unlock first.", "locked");
    }
    if (/modified or untracked files/i.test(err)) {
      throw new RemoveError("This worktree has uncommitted or untracked changes.", "dirty");
    }
    throw new RemoveError(err.replace(/^fatal:\s*/, "") || "git worktree remove failed");
  }

  if (!opts.deleteBranch || !opts.branch) return { branchDeleted: false };
  const b = await execa("git", ["-C", repoPath, "branch", "-d", "--", opts.branch], { reject: false });
  if (b.exitCode === 0) return { branchDeleted: true };
  const note = /not fully merged/i.test(b.stderr)
    ? `Branch ${opts.branch} was kept because it isn't merged.`
    : `Branch ${opts.branch} was kept: ${b.stderr.trim().replace(/^error:\s*/, "")}`;
  return { branchDeleted: false, branchNote: note };
}
