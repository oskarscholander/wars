import { execa } from "execa";
import type { DiffFile, DiffHunk } from "@ww/shared";
import { branchBase } from "./base.ts";

/** Lines kept per file before the rest is summarised, so huge diffs stay usable. */
export const MAX_LINES_PER_FILE = 1500;
const MAX_UNTRACKED = 50;

const unquote = (p: string) => (p.startsWith('"') && p.endsWith('"') ? JSON.parse(p) as string : p);
const stripPrefix = (p: string) => unquote(p).replace(/^[ab]\//, "");

/** Parses unified diff text (`git diff` output) into files and hunks with line numbers. */
export function parseUnifiedDiff(text: string): DiffFile[] {
  const files: DiffFile[] = [];
  let file: DiffFile | null = null;
  let hunk: DiffHunk | null = null;
  let oldLine = 0;
  let newLine = 0;
  let kept = 0;

  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      const m = /^diff --git (?:"?a\/)?(.+?)"? (?:"?b\/)?(.+?)"?$/.exec(line);
      file = { path: m?.[2] ?? line, oldPath: null, added: 0, removed: 0, binary: false, hunks: [] };
      files.push(file);
      hunk = null;
      kept = 0;
      continue;
    }
    if (!file) continue;

    if (!hunk) {
      if (line.startsWith("rename from ")) file.oldPath = line.slice("rename from ".length);
      else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
      else if (line.startsWith("--- ")) {
        const p = line.slice(4);
        if (p !== "/dev/null" && !file.oldPath && stripPrefix(p) !== file.path) file.oldPath = stripPrefix(p);
      } else if (line.startsWith("+++ ")) {
        const p = line.slice(4);
        if (p !== "/dev/null") file.path = stripPrefix(p);
      } else if (line.startsWith("Binary files ") || line === "GIT binary patch") file.binary = true;
    }

    const h = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)$/.exec(line);
    if (h) {
      oldLine = Number(h[1]);
      newLine = Number(h[2]);
      hunk = { header: line, oldStart: oldLine, newStart: newLine, lines: [] };
      file.hunks.push(hunk);
      continue;
    }
    if (!hunk) continue;

    const tag = line[0];
    if (tag === "\\") continue; // "\ No newline at end of file"
    if (tag === "+") file.added++;
    if (tag === "-") file.removed++;
    if (kept >= MAX_LINES_PER_FILE) continue;
    if (tag === "+") hunk.lines.push({ kind: "add", text: line.slice(1), oldLine: null, newLine: newLine++ });
    else if (tag === "-") hunk.lines.push({ kind: "del", text: line.slice(1), oldLine: oldLine++, newLine: null });
    else if (tag === " " || line === "") hunk.lines.push({ kind: "context", text: line.slice(1), oldLine: oldLine++, newLine: newLine++ });
    else continue;
    kept++;
  }
  return files;
}

/** Parses `git diff --numstat`: added/removed per path; `-` for binary. Renames use the new path. */
export function parseNumstat(text: string): Map<string, { added: number; removed: number; binary: boolean }> {
  const out = new Map<string, { added: number; removed: number; binary: boolean }>();
  for (const line of text.split("\n")) {
    const m = /^(\d+|-)\t(\d+|-)\t(.+)$/.exec(line);
    if (!m) continue;
    let path = m[3]!;
    // "src/{old => new}.ts" or "old => new"
    path = path.replace(/\{[^{}]* => ([^{}]*)\}/, "$1").replace(/^.* => /, "").replace(/\/\//g, "/");
    const binary = m[1] === "-";
    out.set(unquote(path), { added: binary ? 0 : Number(m[1]), removed: binary ? 0 : Number(m[2]), binary });
  }
  return out;
}

/** The worktree's changes since its branch forked from main: committed, staged, unstaged and untracked. */
export async function worktreeDiff(worktreePath: string, repoPath: string): Promise<DiffFile[]> {
  const base = await branchBase(worktreePath, repoPath);
  const git = (...args: string[]) => execa("git", ["-C", worktreePath, "-c", "core.quotepath=false", ...args], { reject: false });
  const [numstat, patch, untracked] = await Promise.all([
    git("diff", "--numstat", "-M", base),
    git("diff", "-M", "--no-color", "--no-ext-diff", base),
    git("ls-files", "--others", "--exclude-standard"),
  ]);
  const files = parseUnifiedDiff(patch.stdout);

  // Untracked files are not in `git diff`; diff each against /dev/null without touching the index.
  const extra = untracked.stdout.split("\n").filter(Boolean).slice(0, MAX_UNTRACKED);
  for (const path of extra) {
    const r = await git("diff", "--no-index", "--no-color", "--", "/dev/null", path);
    const [f] = parseUnifiedDiff(r.stdout);
    if (f) files.push({ ...f, path, oldPath: null });
  }

  // numstat is authoritative for counts (the patch may be truncated).
  const counts = parseNumstat(numstat.stdout);
  for (const f of files) {
    const c = counts.get(f.path);
    if (c) Object.assign(f, { added: c.added, removed: c.removed, binary: f.binary || c.binary });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}
