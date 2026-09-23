import { execa } from "execa";

/**
 * The commit a worktree's branch forked from the repo's main branch, so diffs
 * and progress count committed work too. Falls back to HEAD.
 */
export async function branchBase(worktreePath: string, repoPath: string): Promise<string> {
  const main = await execa("git", ["-C", repoPath, "symbolic-ref", "--quiet", "--short", "HEAD"], { reject: false });
  if (main.exitCode === 0 && main.stdout.trim()) {
    const mb = await execa("git", ["-C", worktreePath, "merge-base", "HEAD", main.stdout.trim()], { reject: false });
    if (mb.exitCode === 0 && mb.stdout.trim()) return mb.stdout.trim();
  }
  return "HEAD";
}

/** Files changed since the branch base, including untracked files. */
export async function countChangedFiles(worktreePath: string, repoPath: string): Promise<number> {
  const base = await branchBase(worktreePath, repoPath);
  const [tracked, untracked] = await Promise.all([
    execa("git", ["-C", worktreePath, "diff", "--name-only", base]),
    execa("git", ["-C", worktreePath, "ls-files", "--others", "--exclude-standard"]),
  ]);
  const files = new Set([...tracked.stdout.split("\n"), ...untracked.stdout.split("\n")].filter(Boolean));
  return files.size;
}
