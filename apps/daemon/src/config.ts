import { readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { UNIT_MODELS, type UnitModel } from "@ww/shared";

export interface Config {
  /** Optional: a repo to monitor on first start. Repos are normally picked in the app. */
  repoPath?: string;
  /** Fallback when a repo's test command can't be detected. */
  testCommand?: string[];
  defaultModel: UnitModel;
  port: number;
  /** Folders to scan for repo suggestions. Defaults to ~/Repos, ~/code, ~/src and friends. */
  scanDirs?: string[];
  /** Optional passthrough; by default the SDK uses the user's `claude login`. */
  anthropicApiKey?: string;
}

export const REPO_ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");
export const DEFAULT_CONFIG_PATH = join(REPO_ROOT, "worktree-wars.config.json");
const PLACEHOLDER = "/absolute/path/to/target/repo";

export class ConfigError extends Error {}

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((s) => typeof s === "string");

export function parseConfig(raw: unknown): Config {
  if (typeof raw !== "object" || raw === null) throw new ConfigError("config must be a JSON object");
  const c = raw as Record<string, unknown>;

  if (c.repoPath !== undefined && (typeof c.repoPath !== "string" || !isAbsolute(c.repoPath))) {
    throw new ConfigError("repoPath must be an absolute path when set");
  }
  if (c.testCommand !== undefined && (!isStringArray(c.testCommand) || c.testCommand.length === 0)) {
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
  if (c.scanDirs !== undefined && !isStringArray(c.scanDirs)) throw new ConfigError("scanDirs must be an array of paths");
  if (c.anthropicApiKey !== undefined && typeof c.anthropicApiKey !== "string") {
    throw new ConfigError("anthropicApiKey must be a string when set");
  }

  return {
    ...(typeof c.repoPath === "string" && c.repoPath !== PLACEHOLDER ? { repoPath: c.repoPath } : {}),
    ...(c.testCommand ? { testCommand: c.testCommand as string[] } : {}),
    defaultModel: defaultModel as UnitModel,
    port,
    ...(c.scanDirs ? { scanDirs: c.scanDirs as string[] } : {}),
    ...(c.anthropicApiKey ? { anthropicApiKey: c.anthropicApiKey } : {}),
  };
}

/** The config file is optional: without one, everything uses defaults. */
export async function loadConfig(path = process.env.WW_CONFIG ?? DEFAULT_CONFIG_PATH): Promise<Config> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return parseConfig({});
  }
  try {
    return parseConfig(JSON.parse(text));
  } catch (err) {
    if (err instanceof ConfigError) throw new ConfigError(`${path}: ${err.message}`);
    throw new ConfigError(`${path}: invalid JSON`);
  }
}
