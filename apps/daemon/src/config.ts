import { readFile, stat } from "node:fs/promises";
import { execa } from "execa";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT_MODELS, type UnitModel } from "@ww/shared";

export interface Config {
  repoPath: string;
  testCommand: [string, ...string[]];
  defaultModel: UnitModel;
  port: number;
  /** Optional passthrough; by default the SDK uses the user's `claude login`. */
  anthropicApiKey?: string;
}

export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
export const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "worktree-wars.config.json");

export class ConfigError extends Error {}

export function parseConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("config must be a JSON object");
  const c = raw as Record<string, unknown>;

  if (typeof c.repoPath !== "string" || !isAbsolute(c.repoPath)) {
    throw new ConfigError("repoPath must be an absolute path");
  }
  const testCommand = c.testCommand ?? ["pnpm", "test"];
  if (!Array.isArray(testCommand) || testCommand.length === 0 || !testCommand.every((s) => typeof s === "string")) {
    throw new ConfigError("testCommand must be a non-empty array of strings");
  }
  const defaultModel = c.defaultModel ?? "sonnet";
  if (!UNIT_MODELS.includes(defaultModel as UnitModel)) {
    throw new ConfigError(`defaultModel must be one of ${UNIT_MODELS.join(", ")}`);
  }
  const port = c.port ?? 4477;
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new ConfigError("port must be an integer between 1 and 65535");
  }
  if (c.anthropicApiKey !== undefined && typeof c.anthropicApiKey !== "string") {
    throw new ConfigError("anthropicApiKey must be a string when set");
  }

  return {
    repoPath: c.repoPath,
    testCommand: testCommand as Config["testCommand"],
    defaultModel: defaultModel as UnitModel,
    port,
    ...(c.anthropicApiKey ? { anthropicApiKey: c.anthropicApiKey } : {}),
  };
}

export async function loadConfig(path = process.env.WW_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    throw new ConfigError(`No config at ${path}. Copy worktree-wars.config.example.json and set repoPath.`);
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (err) {
    if (err instanceof ConfigError) throw new ConfigError(`${path}: ${err.message}`);
    throw new ConfigError(`${path}: invalid JSON`);
  }
}

/** Fails fast, in plain words, when repoPath is not a git repository. */
export async function checkRepo(config: Config, configPath = process.env.WW_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<void> {
  const fix = `Set "repoPath" in ${configPath} to the absolute path of a git repository.`;
  if (config.repoPath === "/absolute/path/to/target/repo") {
    throw new ConfigError(`repoPath is still the example placeholder. ${fix}`);
  }
  const isDir = await stat(config.repoPath).then((s) => s.isDirectory(), () => false);
  if (!isDir) throw new ConfigError(`repoPath ${config.repoPath} does not exist. ${fix}`);
  const r = await execa("git", ["-C", config.repoPath, "rev-parse", "--git-dir"], { reject: false });
  if (r.exitCode !== 0) throw new ConfigError(`repoPath ${config.repoPath} is not a git repository. ${fix}`);
}
