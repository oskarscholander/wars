import { describe, expect, it } from "vitest";
import { applyEvent, replay } from "./reducer.ts";
import { emptyState, emptyTests, type Front, type Unit } from "./types.ts";
import type { ServerEvent } from "./protocol.ts";

const front = (id: string): Front => ({
  id,
  path: `/repo-${id}`,
  branch: `feat/${id}`,
  head: "abc",
  locked: false,
  prunable: false,
  tests: emptyTests(),
  pr: null,
});

const unit = (id: string, frontId: string): Unit => ({
  id,
  frontId,
  name: id,
  model: "sonnet",
  status: "idle",
  sessionId: null,
  turns: 0,
  filesChanged: 0,
  inputTokens: 0,
  outputTokens: 0,
  costUsd: 0,
  queuedOrders: 0,
  replyId: null,
  reply: "",
  createdAt: 0,
});

describe("applyEvent", () => {
  it("snapshot replaces state", () => {
    const s = replay([{ type: "front.upserted", front: front("a") }]);
    const next = applyEvent(s, { type: "state.snapshot", state: emptyState() });
    expect(next).toEqual(emptyState());
  });

  it("removing a front drops its units, permissions and diffs", () => {
    const s = replay([
      { type: "front.upserted", front: front("a") },
      { type: "front.upserted", front: front("b") },
      { type: "unit.upserted", unit: unit("u1", "a") },
      { type: "unit.upserted", unit: unit("u2", "b") },
      {
        type: "permission.request",
        request: { id: "p1", unitId: "u1", frontId: "a", tool: "Bash", input: {}, summary: "", createdAt: 0 },
      },
      { type: "diff.updated", frontId: "a", files: [] },
      { type: "front.removed", frontId: "a" },
    ]);
    expect(Object.keys(s.fronts)).toEqual(["b"]);
    expect(Object.keys(s.units)).toEqual(["u2"]);
    expect(s.permissions).toEqual({});
    expect(s.diffs).toEqual({});
  });

  it("ignores units on unknown fronts", () => {
    const s = replay([{ type: "unit.upserted", unit: unit("u1", "nope") }]);
    expect(s.units).toEqual({});
  });

  it("streams text into the current message and resets on a new one", () => {
    const events: ServerEvent[] = [
      { type: "front.upserted", front: front("a") },
      { type: "unit.upserted", unit: unit("u1", "a") },
      { type: "unit.text", unitId: "u1", messageId: "m1", delta: "Hel" },
      { type: "unit.text", unitId: "u1", messageId: "m1", delta: "lo" },
    ];
    expect(replay(events).units.u1?.reply).toBe("Hello");
    const s = replay([...events, { type: "unit.text", unitId: "u1", messageId: "m2", delta: "Next" }]);
    expect(s.units.u1?.reply).toBe("Next");
  });

  it("tracks PR open then merged", () => {
    const s = replay([
      { type: "front.upserted", front: front("a") },
      { type: "pr.opened", frontId: "a", number: 7, url: "u" },
      { type: "pr.merged", frontId: "a" },
    ]);
    expect(s.fronts.a?.pr).toEqual({ number: 7, url: "u", state: "merged" });
  });

  it("does not mutate the previous state", () => {
    const s = replay([{ type: "front.upserted", front: front("a") }]);
    const frozen = JSON.parse(JSON.stringify(s));
    applyEvent(s, { type: "front.removed", frontId: "a" });
    expect(s).toEqual(frozen);
  });
});
