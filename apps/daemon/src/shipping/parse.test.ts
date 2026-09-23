import { describe, expect, it } from "vitest";
import { parsePrUrl, parsePrView, parseTestCounts, tail } from "./parse.ts";

describe("parseTestCounts", () => {
  it("reads vitest summaries, including colour codes", () => {
    expect(parseTestCounts(" Test Files  8 passed (8)\n      Tests  57 passed (57)\n")).toEqual({ passed: 57, failed: 0 });
    expect(parseTestCounts("\x1b[2m      Tests \x1b[22m \x1b[31m2 failed\x1b[39m | 55 passed (57)")).toEqual({ passed: 55, failed: 2 });
  });
  it("reads jest, pytest, mocha and node:test", () => {
    expect(parseTestCounts("Tests:       1 failed, 5 passed, 6 total")).toEqual({ passed: 5, failed: 1 });
    expect(parseTestCounts("===== 2 failed, 10 passed in 0.52s =====")).toEqual({ passed: 10, failed: 2 });
    expect(parseTestCounts("  10 passing (20ms)\n  2 failing")).toEqual({ passed: 10, failed: 2 });
    expect(parseTestCounts("# tests 3\n# pass 3\n# fail 0")).toEqual({ passed: 3, failed: 0 });
  });
  it("falls back to zeros", () => {
    expect(parseTestCounts("ok")).toEqual({ passed: 0, failed: 0 });
  });
});

describe("tail", () => {
  it("keeps the last lines", () => {
    expect(tail("a\nb\nc\n", 2)).toBe("b\nc");
  });
});

describe("PR parsing", () => {
  it("extracts the PR number and url", () => {
    expect(parsePrUrl("Creating pull request...\nhttps://github.com/o/r/pull/42\n")).toEqual({ number: 42, url: "https://github.com/o/r/pull/42" });
    expect(parsePrUrl("nothing")).toBeNull();
  });
  it("maps gh pr view states", () => {
    expect(parsePrView('{"number":3,"state":"OPEN","url":"u"}')).toEqual({ number: 3, url: "u", state: "open" });
    expect(parsePrView('{"number":3,"state":"MERGED","url":"u"}')?.state).toBe("merged");
    expect(parsePrView('{"number":3,"state":"CLOSED","url":"u"}')?.state).toBe("closed");
    expect(parsePrView("not json")).toBeNull();
  });
});
