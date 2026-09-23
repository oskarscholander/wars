/** Splits a command line into an argument array. Supports "double" and 'single' quotes; no shell expansion. */
export function splitArgs(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if (started || cur) out.push(cur);
      cur = "";
      started = false;
    } else {
      cur += ch;
    }
  }
  if (started || cur) out.push(cur);
  return out;
}

export const joinArgs = (args: string[]) => args.map((a) => (/[\s"']/.test(a) || !a ? JSON.stringify(a) : a)).join(" ");
