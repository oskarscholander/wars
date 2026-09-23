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
