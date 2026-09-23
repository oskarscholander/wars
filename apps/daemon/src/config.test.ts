import { describe, expect, it } from "vitest";
import { ConfigError, parseConfig } from "./config.ts";

describe("parseConfig", () => {
  it("works with no settings at all", () => {
    expect(parseConfig({})).toEqual({ defaultModel: "sonnet", port: 4477 });
  });

  it("ignores the example placeholder repoPath", () => {
    expect(parseConfig({ repoPath: "/absolute/path/to/target/repo" }).repoPath).toBeUndefined();
    expect(parseConfig({ repoPath: "/r" }).repoPath).toBe("/r");
  });

  it("keeps optional settings", () => {
    const c = parseConfig({ anthropicApiKey: "k", testCommand: ["make", "check"], scanDirs: ["/src"] });
    expect(c).toMatchObject({ anthropicApiKey: "k", testCommand: ["make", "check"], scanDirs: ["/src"] });
  });

  it("rejects bad values", () => {
    expect(() => parseConfig({ repoPath: "relative" })).toThrow(ConfigError);
    expect(() => parseConfig({ testCommand: "pnpm test" })).toThrow(ConfigError);
    expect(() => parseConfig({ defaultModel: "gpt" })).toThrow(ConfigError);
    expect(() => parseConfig({ port: 0 })).toThrow(ConfigError);
    expect(() => parseConfig({ scanDirs: "~/code" })).toThrow(ConfigError);
  });
});
