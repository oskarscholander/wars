import { describe, expect, it } from "vitest";
import { parseClientCommand } from "./commands.ts";

describe("parseClientCommand", () => {
  it("accepts well-formed commands", () => {
    expect(parseClientCommand({ type: "front.create", branch: "feat/x" })).toEqual({ type: "front.create", branch: "feat/x" });
    expect(parseClientCommand({ type: "unit.create", frontId: "f", model: "opus", name: "Tank" })).toMatchObject({
      model: "opus",
    });
    expect(parseClientCommand({ type: "permission.resolve", id: "p", allow: false, message: "no" })).toEqual({
      type: "permission.resolve",
      id: "p",
      allow: false,
      message: "no",
    });
  });

  it("drops unknown fields", () => {
    expect(parseClientCommand({ type: "tests.run", frontId: "f", extra: 1 })).toEqual({ type: "tests.run", frontId: "f" });
  });

  it("rejects malformed input", () => {
    for (const bad of [
      null,
      "front.create",
      { type: "nope" },
      { type: "front.create" },
      { type: "front.create", branch: "" },
      { type: "unit.create", frontId: "f", model: "gpt", name: "x" },
      { type: "permission.resolve", id: "p", allow: "yes" },
      { type: "pr.open", frontId: 5 },
    ]) {
      expect(parseClientCommand(bad)).toBeNull();
    }
  });
});
