import { describe, expect, it } from "vitest";
import { frontIdFor, linkedWorktrees, parseWorktreePorcelain } from "./worktrees.ts";

const PORCELAIN = `worktree /src/app
HEAD 1111111111111111111111111111111111111111
branch refs/heads/main

worktree /src/app-feat-comments
HEAD 2222222222222222222222222222222222222222
branch refs/heads/feat/comments

worktree /src/app detached
HEAD 3333333333333333333333333333333333333333
detached
locked reason with spaces

worktree /src/app-gone
HEAD 4444444444444444444444444444444444444444
branch refs/heads/old
prunable gitdir file points to non-existent location
`;

describe("parseWorktreePorcelain", () => {
  const trees = parseWorktreePorcelain(PORCELAIN);

  it("parses every entry", () => {
    expect(trees.map((t) => t.path)).toEqual(["/src/app", "/src/app-feat-comments", "/src/app detached", "/src/app-gone"]);
  });

  it("strips refs/heads and keeps slashes in branch names", () => {
    expect(trees[1]).toMatchObject({ branch: "feat/comments", head: "2".repeat(40), locked: false });
  });

  it("handles detached, locked and prunable", () => {
    expect(trees[2]).toMatchObject({ branch: null, locked: true, prunable: false });
    expect(trees[3]).toMatchObject({ branch: "old", prunable: true });
  });

  it("excludes the main worktree and bare entries from islands", () => {
    const bare = parseWorktreePorcelain("worktree /src/app.git\nbare\n\nworktree /src/x\nHEAD a\nbranch refs/heads/x\n\nworktree /src/y\nbare\n");
    expect(linkedWorktrees(bare).map((t) => t.path)).toEqual(["/src/x"]);
    expect(linkedWorktrees(trees)).toHaveLength(3);
  });

  it("returns nothing for empty output", () => {
    expect(parseWorktreePorcelain("")).toEqual([]);
  });
});

describe("frontIdFor", () => {
  it("is stable and path-specific", () => {
    expect(frontIdFor("/a")).toBe(frontIdFor("/a"));
    expect(frontIdFor("/a")).not.toBe(frontIdFor("/b"));
    expect(frontIdFor("/a")).toMatch(/^[0-9a-f]{12}$/);
  });
});
