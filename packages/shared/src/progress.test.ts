import { describe, expect, it } from "vitest";
import { BUNKER_AT, unitProgress } from "./progress.ts";
import { emptyTests } from "./types.ts";

const tests = emptyTests();

describe("unitProgress", () => {
  it("grows with files and turns, capped at 0.95", () => {
    expect(unitProgress({ filesChanged: 2, turns: 3 }, { tests, pr: null })).toBeCloseTo(0.25);
    expect(unitProgress({ filesChanged: 50, turns: 50 }, { tests, pr: null })).toBe(0.95);
  });

  it("stops before the bunker while tests fail", () => {
    const failed = { ...tests, status: "failed" as const };
    expect(unitProgress({ filesChanged: 50, turns: 0 }, { tests: failed, pr: null })).toBeLessThan(BUNKER_AT);
  });

  it("reaches the flag once a PR is open", () => {
    const pr = { number: 1, url: "", state: "open" as const };
    expect(unitProgress({ filesChanged: 0, turns: 0 }, { tests, pr })).toBe(1);
  });
});
