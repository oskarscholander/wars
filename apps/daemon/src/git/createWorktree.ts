import { basename, dirname, join } from "node:path";
import { execa } from "execa";

export const branchSlug = (branch: string): string =>
  branch
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

/** Sibling directory named `<repo>-<slug>`, per the spec. */
export const worktreePathFor = (repoPath: string, branch: string): string =>
  join(dirname(repoPath), `${basename(repoPath)}-${branchSlug(branch)}`);

export class WorktreeError extends Error {}

async function validBranchName(repoPath: string, branch: string): Promise<boolean> {
  if (!branch || branch.startsWith("-")) return false;
  const r = await execa("git", ["-C", repoPath, "check-ref-format", "--branch", branch], { reject: false });
  return r.exitCode === 0;
}

async function branchExists(repoPath: string, branch: string): Promise<boolean> {
  const r = await execa("git", ["-C", repoPath, "show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
    reject: false,
  });
  return r.exitCode === 0;
}

/** Runs `git worktree add ../<repo>-<slug> -b <branch>`, or checks out the branch if it already exists. */
export async function createWorktree(repoPath: string, branch: string): Promise<string> {
  const name = branch.trim();
  if (!(await validBranchName(repoPath, name)) || !branchSlug(name)) {
    throw new WorktreeError(`"${branch}" is not a valid branch name`);
  }
  const path = worktreePathFor(repoPath, name);
  const args = (await branchExists(repoPath, name))
    ? ["-C", repoPath, "worktree", "add", "--", path, name]
    : ["-C", repoPath, "worktree", "add", "-b", name, "--", path];
  const r = await execa("git", args, { reject: false });
  if (r.exitCode !== 0) throw new WorktreeError(r.stderr.trim() || `git worktree add failed (${r.exitCode})`);
  return path;
}
