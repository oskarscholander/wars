import { describe, expect, it } from "vitest";
import { replay as replayEvents, type Front, type ServerEvent } from "@ww/shared";
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
const REPO: ServerEvent = { type: "repo.upserted", repo: { id: "r", path: "/repo", name: "repo", testCommand: [] } };
const replay = (events: ServerEvent[]) => replayEvents([REPO, ...events]);

describe("diffFronts", () => {
  it("adds new worktrees and skips the main one", () => {
    const events = diffFronts({}, [MAIN, tree("/repo-a", "a")], "r");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "front.upserted", front: { id: frontIdFor("/repo-a"), branch: "a" } });
  });

  it("emits nothing when nothing changed", () => {
    const trees = [MAIN, tree("/repo-a", "a")];
    const state = replay(diffFronts({}, trees, "r"));
    expect(diffFronts(state.fronts, trees, "r")).toEqual([]);
  });

  it("updates git facts but keeps tests and PR state", () => {
    const state = replay([
      ...diffFronts({}, [MAIN, tree("/repo-a", "a")], "r"),
      { type: "pr.opened", frontId: frontIdFor("/repo-a"), number: 3, url: "u" },
    ]);
    const events = diffFronts(state.fronts, [MAIN, tree("/repo-a", "a", "h2")], "r");
    expect(events).toHaveLength(1);
    const front = (events[0] as { front: Front }).front;
    expect(front.head).toBe("h2");
    expect(front.pr?.number).toBe(3);
  });

  it("only touches fronts of its own repo", () => {
    const state = replayEvents([
      REPO,
      { type: "repo.upserted", repo: { id: "r2", path: "/other", name: "other", testCommand: [] } },
      ...diffFronts({}, [MAIN, tree("/repo-a", "a")], "r"),
      ...diffFronts({}, [tree("/other", "main"), tree("/other-b", "b")], "r2"),
    ]);
    expect(Object.keys(state.fronts)).toHaveLength(2);
    expect(diffFronts(state.fronts, [MAIN, tree("/repo-a", "a")], "r")).toEqual([]);
  });

  it("removes worktrees that disappeared", () => {
    const state = replay(diffFronts({}, [MAIN, tree("/repo-a", "a"), tree("/repo-b", "b")], "r"));
    expect(diffFronts(state.fronts, [MAIN, tree("/repo-b", "b")], "r")).toEqual([
      { type: "front.removed", frontId: frontIdFor("/repo-a") },
    ]);
  });
});
