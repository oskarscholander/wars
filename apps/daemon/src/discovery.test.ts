import { describe, expect, it } from "vitest";
import { replay, type Front } from "@ww/shared";
import { diffFronts } from "./discovery.ts";
import { frontIdFor, type Worktree } from "./git/worktrees.ts";

const tree = (path: string, branch: string, head = "h1"): Worktree => ({
  path,
  branch,
  head,
  bare: false,
  locked: false,
  prunable: false,
});
const MAIN = tree("/repo", "main");

describe("diffFronts", () => {
  it("adds new worktrees and skips the main one", () => {
    const events = diffFronts({}, [MAIN, tree("/repo-a", "a")]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "front.upserted", front: { id: frontIdFor("/repo-a"), branch: "a" } });
  });

  it("emits nothing when nothing changed", () => {
    const trees = [MAIN, tree("/repo-a", "a")];
    const state = replay(diffFronts({}, trees));
    expect(diffFronts(state.fronts, trees)).toEqual([]);
  });

  it("updates git facts but keeps tests and PR state", () => {
    const state = replay([
      ...diffFronts({}, [MAIN, tree("/repo-a", "a")]),
      { type: "pr.opened", frontId: frontIdFor("/repo-a"), number: 3, url: "u" },
    ]);
    const events = diffFronts(state.fronts, [MAIN, tree("/repo-a", "a", "h2")]);
    expect(events).toHaveLength(1);
    const front = (events[0] as { front: Front }).front;
    expect(front.head).toBe("h2");
    expect(front.pr?.number).toBe(3);
  });

  it("removes worktrees that disappeared", () => {
    const state = replay(diffFronts({}, [MAIN, tree("/repo-a", "a"), tree("/repo-b", "b")]));
    expect(diffFronts(state.fronts, [MAIN, tree("/repo-b", "b")])).toEqual([
      { type: "front.removed", frontId: frontIdFor("/repo-a") },
    ]);
  });
});
