import { describe, expect, it } from "vitest";
import { parseClientCommand } from "./commands.ts";

describe("parseClientCommand", () => {
  it("accepts well-formed commands", () => {
    expect(parseClientCommand({ type: "front.create", repoId: "r", branch: "feat/x" })).toEqual({ type: "front.create", repoId: "r", branch: "feat/x" });
    expect(parseClientCommand({ type: "repo.add", path: "~/code/app" })).toEqual({ type: "repo.add", path: "~/code/app" });
    expect(parseClientCommand({ type: "repo.update", repoId: "r", testCommand: ["make", "test"] })).toMatchObject({ testCommand: ["make", "test"] });
    expect(parseClientCommand({ type: "repo.suggest" })).toEqual({ type: "repo.suggest" });
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
      { type: "front.create", branch: "x" },
      { type: "repo.add", path: "" },
      { type: "repo.update", repoId: "r", testCommand: "make test" },
      { type: "unit.create", frontId: "f", model: "gpt", name: "x" },
      { type: "permission.resolve", id: "p", allow: "yes" },
      { type: "pr.open", frontId: 5 },
    ]) {
      expect(parseClientCommand(bad)).toBeNull();
    }
  });
});
