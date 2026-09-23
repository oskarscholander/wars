import type { PrState } from "@ww/shared";

// eslint-disable-next-line no-control-regex -- stripping ANSI colour codes
const ANSI = /\x1b\[[0-9;]*m/g;

/** Best-effort pass/fail counts from common runners' summaries (vitest, jest, pytest, mocha, node:test). */
export function parseTestCounts(output: string): { passed: number; failed: number } {
  const text = output.replace(ANSI, "");
  const last = (re: RegExp) => {
    const all = [...text.matchAll(re)];
    return all.length ? Number(all.at(-1)![1]) : null;
  };
  // vitest: "Tests  2 failed | 57 passed (59)"; jest: "Tests:       1 failed, 5 passed, 6 total"
  const testsLine = [...text.matchAll(/^\s*Tests:?\s+(.*)$/gm)].at(-1)?.[1];
  if (testsLine) {
    const f = /(\d+) failed/.exec(testsLine);
    const p = /(\d+) passed/.exec(testsLine);
    if (f || p) return { passed: p ? Number(p[1]) : 0, failed: f ? Number(f[1]) : 0 };
  }
  // pytest: "==== 2 failed, 10 passed in 0.52s ===="
  const py = [...text.matchAll(/=+ (.*?) in [\d.]+s/g)].at(-1)?.[1];
  if (py && /passed|failed/.test(py)) {
    return { passed: Number(/(\d+) passed/.exec(py)?.[1] ?? 0), failed: Number(/(\d+) failed/.exec(py)?.[1] ?? 0) };
  }
  // mocha: "10 passing", "2 failing"; node:test: "# pass 10", "# fail 2"
  const passing = last(/(\d+) passing/g) ?? last(/^# pass (\d+)/gm);
  const failing = last(/(\d+) failing/g) ?? last(/^# fail (\d+)/gm);
  return { passed: passing ?? 0, failed: failing ?? 0 };
}

/** The last `lines` lines, capped at `chars` characters. */
export function tail(output: string, lines = 40, chars = 4000): string {
  const t = output.replace(ANSI, "").trimEnd().split("\n").slice(-lines).join("\n");
  return t.length > chars ? t.slice(-chars) : t;
}

export function parsePrUrl(output: string): { number: number; url: string } | null {
  const m = /(https?:\/\/\S+\/pull\/(\d+))/.exec(output);
  return m ? { url: m[1]!, number: Number(m[2]) } : null;
}

/** Maps `gh pr view --json number,state,url` output to our PR state. */
export function parsePrView(json: string): PrState | null {
  try {
    const v = JSON.parse(json) as { number?: unknown; state?: unknown; url?: unknown };
    if (typeof v.number !== "number" || typeof v.url !== "string" || typeof v.state !== "string") return null;
    const s = v.state.toUpperCase();
    return { number: v.number, url: v.url, state: s === "MERGED" ? "merged" : s === "OPEN" ? "open" : "closed" };
  } catch {
    return null;
  }
}
