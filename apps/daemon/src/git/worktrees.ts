import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { execa } from "execa";

export interface Worktree {
  path: string;
  head: string;
  /** Short branch name, or null when detached. */
  branch: string | null;
  bare: boolean;
  locked: boolean;
  prunable: boolean;
  /** Filled in by discovery for linked worktrees. */
  createdAt?: number | null;
}

/** Parses `git worktree list --porcelain`. The first entry is the main worktree. */
export function parseWorktreePorcelain(output: string): Worktree[] {
  const trees: Worktree[] = [];
  let cur: Worktree | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      cur = { path: line.slice("worktree ".length), head: "", branch: null, bare: false, locked: false, prunable: false };
      trees.push(cur);
      continue;
    }
    if (!cur) continue;
    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ");
    switch (key) {
      case "HEAD":
        cur.head = value;
        break;
      case "branch":
        cur.branch = value.replace(/^refs\/heads\//, "");
        break;
      case "bare":
        cur.bare = true;
        break;
      case "locked":
        cur.locked = true;
        break;
      case "prunable":
        cur.prunable = true;
        break;
    }
  }
  return trees;
}

/** Linked worktrees only: the main worktree and bare entries are not islands. */
export const linkedWorktrees = (trees: Worktree[]): Worktree[] => trees.slice(1).filter((t) => !t.bare);

export const frontIdFor = (path: string): string => createHash("sha1").update(path).digest("hex").slice(0, 12);

export async function listWorktrees(repoPath: string): Promise<Worktree[]> {
  const { stdout } = await execa("git", ["-C", repoPath, "worktree", "list", "--porcelain"]);
  return parseWorktreePorcelain(stdout);
}

export async function gitCommonDir(repoPath: string): Promise<string> {
  const { stdout } = await execa("git", ["-C", repoPath, "rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return stdout.trim();
}

/**
 * When a linked worktree was created, from git's admin folder for it
 * (`.git/worktrees/<name>`, made by `git worktree add`). Uses the folder's birth
 * time where the filesystem records one, else the `gitdir` file inside it,
 * which git writes once at creation. Null when neither can be read.
 */
export async function worktreeCreatedAt(worktreePath: string): Promise<number | null> {
  try {
    const dotGit = (await readFile(join(worktreePath, ".git"), "utf8")).trim();
    const m = /^gitdir:\s*(.+)$/m.exec(dotGit);
    if (!m) return null;
    const admin = isAbsolute(m[1]!) ? m[1]! : resolve(worktreePath, m[1]!);
    const [dir, gitdir] = await Promise.all([stat(admin), stat(join(admin, "gitdir")).catch(() => null)]);
    const times = [dir.birthtimeMs, gitdir?.mtimeMs ?? 0].filter((t) => t > 0);
    return times.length ? Math.round(Math.min(...times)) : null;
  } catch {
    return null;
  }
}
