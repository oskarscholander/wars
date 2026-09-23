import { describe, expect, it } from "vitest";
import { isLocalRequest } from "./server.ts";

describe("isLocalRequest", () => {
  it("allows local hosts and origins", () => {
    expect(isLocalRequest("127.0.0.1:4477", undefined)).toBe(true);
    expect(isLocalRequest("localhost:4477", "http://localhost:5173")).toBe(true);
    expect(isLocalRequest("127.0.0.1:4477", "http://127.0.0.1:5173")).toBe(true);
  });

  it("rejects rebinding hosts and foreign origins", () => {
    expect(isLocalRequest("evil.example:4477", undefined)).toBe(false);
    expect(isLocalRequest("127.0.0.1:4477", "https://evil.example")).toBe(false);
    expect(isLocalRequest("127.0.0.1:4477", "null")).toBe(false);
    expect(isLocalRequest(undefined, undefined)).toBe(false);
  });
});
