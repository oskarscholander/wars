import { randomBytes, timingSafeEqual } from "node:crypto";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export const wwHome = () => process.env.WW_HOME ?? join(homedir(), ".worktree-wars");
export const tokenPath = () => join(wwHome(), "token");

/** Reads the handshake token, generating it on first run. */
export async function ensureToken(): Promise<string> {
  const path = tokenPath();
  try {
    const existing = (await readFile(path, "utf8")).trim();
    if (existing) return existing;
  } catch {
    // first run
  }
  await mkdir(wwHome(), { recursive: true, mode: 0o700 });
  const token = randomBytes(32).toString("hex");
  await writeFile(path, token + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
  return token;
}

export function tokensMatch(expected: string, given: string | undefined): boolean {
  if (!given) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}
