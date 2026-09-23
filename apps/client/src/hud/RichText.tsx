import { Fragment, type ReactNode } from "react";

// Markdown links [text](http…) or bare http(s) URLs. Only http(s) ever becomes a link.
const LINK = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s<>"'`]+)/g;

/** Trailing punctuation usually belongs to the sentence, not the URL; a ")" stays only if it closes one in the URL. */
function trimUrl(url: string): [string, string] {
  let end = url.length;
  const count = (ch: string, upTo: number) => url.slice(0, upTo).split(ch).length - 1;
  while (end > 0) {
    const c = url[end - 1]!;
    if (".,;:!?]".includes(c)) end--;
    else if (c === ")" && count(")", end) > count("(", end)) end--;
    else break;
  }
  return [url.slice(0, end), url.slice(end)];
}

export function linkify(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(LINK)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    if (m[2]) {
      out.push(
        <a key={at} href={m[2]} target="_blank" rel="noopener noreferrer">
          {m[1]}
        </a>,
      );
    } else {
      const [url, tail] = trimUrl(m[3]!);
      out.push(
        <a key={at} href={url} target="_blank" rel="noopener noreferrer">
          {url}
        </a>,
      );
      if (tail) out.push(tail);
    }
    last = at + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Just enough formatting for agent replies: fenced code blocks, inline `code`, and clickable links. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <pre key={i}>{linkify(part.replace(/\n$/, ""))}</pre>
        ) : (
          <Fragment key={i}>
            {part.split(/(`[^`\n]+`)/).map((seg, j) =>
              seg.startsWith("`") && seg.endsWith("`") && seg.length > 2 ? (
                <code key={j}>{linkify(seg.slice(1, -1))}</code>
              ) : (
                <Fragment key={j}>{linkify(seg)}</Fragment>
              ),
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
