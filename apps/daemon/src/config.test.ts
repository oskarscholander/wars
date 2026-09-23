import { describe, expect, it } from "vitest";
import { checkRepo, ConfigError, parseConfig } from "./config.ts";

describe("parseConfig", () => {
  it("fills defaults", () => {
    expect(parseConfig({ repoPath: "/r" })).toEqual({
      repoPath: "/r",
      testCommand: ["pnpm", "test"],
      defaultModel: "sonnet",
      port: 4477,
    });
  });

  it("keeps an optional API key passthrough", () => {
    expect(parseConfig({ repoPath: "/r", anthropicApiKey: "k" }).anthropicApiKey).toBe("k");
  });

  it("rejects bad values", () => {
    expect(() => parseConfig({ repoPath: "relative" })).toThrow(ConfigError);
    expect(() => parseConfig({ repoPath: "/r", testCommand: "pnpm test" })).toThrow(ConfigError);
    expect(() => parseConfig({ repoPath: "/r", defaultModel: "gpt" })).toThrow(ConfigError);
    expect(() => parseConfig({ repoPath: "/r", port: 0 })).toThrow(ConfigError);
  });
});

describe("checkRepo", () => {
  const cfg = (repoPath: string) => parseConfig({ repoPath });
  it("explains the placeholder, missing paths and non-repos", async () => {
    await expect(checkRepo(cfg("/absolute/path/to/target/repo"), "c.json")).rejects.toThrow(/placeholder/);
    await expect(checkRepo(cfg("/definitely/not/here"), "c.json")).rejects.toThrow(/does not exist/);
    await expect(checkRepo(cfg("/"), "c.json")).rejects.toThrow(/not a git repository/);
  });
});
