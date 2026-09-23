import { describe, expect, it } from "vitest";
import { assistant, init, messageStart, result, textDelta, textStart } from "./fixtures.ts";
import { TurnMapper } from "./mapMessage.ts";

describe("TurnMapper", () => {
  it("captures the session id from init", () => {
    expect(new TurnMapper().map(init("s1", "default"))).toEqual([{ kind: "session", sessionId: "s1", permissionMode: "default" }]);
  });

  it("streams text deltas and skips the repeated full text", () => {
    const t = new TurnMapper();
    expect(t.map(messageStart("m1"))).toEqual([]);
    expect(t.map(textDelta("Hel"))).toEqual([{ kind: "text", messageId: "m1", delta: "Hel" }]);
    t.map(textDelta("lo"));
    expect(t.map(assistant("m1", [{ type: "text", text: "Hello" }]))).toEqual([]);
  });

  it("separates text blocks within one message", () => {
    const t = new TurnMapper();
    t.map(messageStart("m1"));
    t.map(textStart());
    t.map(textDelta("One."));
    expect(t.map(textStart())).toEqual([{ kind: "text", messageId: "m1", delta: "\n\n" }]);
  });

  it("falls back to full text when nothing was streamed", () => {
    const t = new TurnMapper();
    expect(t.map(assistant("m2", [{ type: "text", text: "Hi" }]))).toEqual([{ kind: "text", messageId: "m2", delta: "Hi" }]);
  });

  it("maps tool calls with a summary", () => {
    const t = new TurnMapper();
    expect(t.map(assistant("m3", [{ type: "tool_use", name: "Bash", input: { command: "pnpm test" } }]))).toEqual([
      { kind: "tool", tool: "Bash", summary: "pnpm test" },
    ]);
  });

  it("shows paths inside the worktree relative to it", () => {
    const t = new TurnMapper("/w/app");
    expect(t.map(assistant("m4", [{ type: "tool_use", name: "Edit", input: { file_path: "/w/app/src/a.ts" } }]))).toEqual([
      { kind: "tool", tool: "Edit", summary: "src/a.ts" },
    ]);
  });

  it("ignores subagent traffic", () => {
    const t = new TurnMapper();
    t.map(messageStart("m1"));
    expect(t.map(textDelta("x", "toolu_1"))).toEqual([]);
    expect(t.map(assistant("m9", [{ type: "text", text: "x" }], "toolu_1"))).toEqual([]);
  });

  it("maps results including cache tokens and errors", () => {
    expect(new TurnMapper().map(result())).toEqual([
      { kind: "result", ok: true, costUsd: 0.01, inputTokens: 100, outputTokens: 5, errorText: null },
    ]);
    const [err] = new TurnMapper().map(result({ subtype: "error_max_turns", errors: [] }));
    expect(err).toMatchObject({ ok: false, errorText: "error max turns" });
    const [apiErr] = new TurnMapper().map(result({ is_error: true, result: "API down" }));
    expect(apiErr).toMatchObject({ ok: false, errorText: "API down" });
  });
});
