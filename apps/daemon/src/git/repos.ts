import { existsSync } from "node:fs";
import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { RepoSuggestion } from "@ww/shared";
import { listWorktrees } from "./worktrees.ts";

export class RepoError extends Error {}

export const expandHome = (p: string) => (p === "~" ? homedir() : p.startsWith("~/") ? join(homedir(), p.slice(2)) : p);

/** Resolves any path inside a repo (or one of its worktrees) to the repo's main worktree. */
export async function resolveRepoRoot(input: string): Promise<string> {
  const raw = expandHome(input.trim());
  if (!raw) throw new RepoError("Enter a folder path");
  const abs = isAbsolute(raw) ? raw : resolve(homedir(), raw);
  const isDir = await stat(abs).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new RepoError(`${input} is not a folder`);
  let trees;
  try {
    trees = await listWorktrees(abs);
  } catch {
    throw new RepoError(`${input} is not inside a git repository`);
  }
  const main = trees[0];
  if (!main || main.bare) throw new RepoError("Bare repositories have no main worktree to monitor");
  return realpath(main.path);
}

const exists = (dir: string, name: string) => existsSync(join(dir, name));

/** Guesses how to run a repo's tests from the files in it. Null when nothing fits. */
export async function detectTestCommand(dir: string): Promise<string[] | null> {
  if (exists(dir, "package.json")) {
    try {
      const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as { scripts?: Record<string, string> };
      const test = pkg.scripts?.test;
      if (test && !/no test specified/.test(test)) {
        if (exists(dir, "pnpm-lock.yaml")) return ["pnpm", "test"];
        if (exists(dir, "yarn.lock")) return ["yarn", "test"];
        if (exists(dir, "bun.lockb") || exists(dir, "bun.lock")) return ["bun", "run", "test"];
        return ["npm", "test"];
      }
    } catch {
      // unreadable package.json: keep looking
    }
  }
  if (exists(dir, "Cargo.toml")) return ["cargo", "test"];
  if (exists(dir, "go.mod")) return ["go", "test", "./..."];
  if (exists(dir, "mix.exs")) return ["mix", "test"];
  if (["pyproject.toml", "pytest.ini", "tox.ini", "setup.cfg"].some((f) => exists(dir, f))) return ["pytest"];
  if (exists(dir, "Gemfile") && exists(dir, "spec")) return ["bundle", "exec", "rspec"];
  if (exists(dir, "Makefile")) {
    const mk = await readFile(join(dir, "Makefile"), "utf8").catch(() => "");
    if (/^test:/m.test(mk)) return ["make", "test"];
  }
  return null;
}

const SCAN_DIRS = ["Repos", "repos", "code", "Code", "src", "Projects", "projects", "dev", "Developer", "work", "git", "GitHub", "Sites"];
const SKIP = new Set(["node_modules", "vendor", "target", "dist", "build"]);

/** Where to look for repos to suggest: common code folders in the home directory. */
export const defaultScanRoots = () => SCAN_DIRS.map((d) => join(homedir(), d));

/**
 * Finds main worktrees (folders with a `.git` directory) up to `depth` levels
 * below each root. Linked worktrees (`.git` file) belong to another repo and are skipped.
 */
export async function findRepos(roots: string[], depth = 2, limit = 300): Promise<RepoSuggestion[]> {
  const found = new Map<string, RepoSuggestion>();
  const walk = async (dir: string, level: number): Promise<void> => {
    if (found.size >= limit) return;
    const isRepo = await stat(join(dir, ".git")).then((s) => s.isDirectory(), () => false);
    if (isRepo) {
      const real = await realpath(dir).catch(() => dir);
      found.set(real, { path: real, name: basename(real) });
      return;
    }
    // Build and dependency folders are never descended into, but one that is itself a repo still counts.
    if (level >= depth || (level > 0 && SKIP.has(basename(dir)))) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((e) => e.isDirectory() && !e.name.startsWith("."))
        .map((e) => walk(join(dir, e.name), level + 1)),
    );
  };
  const seenRoots = new Set<string>();
  for (const root of roots) {
    const real = await realpath(root).catch(() => null);
    if (!real || seenRoots.has(real)) continue; // case-insensitive filesystems list ~/Code and ~/code twice
    seenRoots.add(real);
    await walk(real, 0);
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
}
