import { Fragment } from "react";

/** Just enough formatting for agent replies: fenced code blocks and inline `code`. */
export function RichText({ text }: { text: string }) {
  const parts = text.split(/```[^\n]*\n?/);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 ? (
          <pre key={i}>{part.replace(/\n$/, "")}</pre>
        ) : (
          <Fragment key={i}>
            {part.split(/(`[^`\n]+`)/).map((seg, j) =>
              seg.startsWith("`") && seg.endsWith("`") && seg.length > 2 ? (
                <code key={j}>{seg.slice(1, -1)}</code>
              ) : (
                <Fragment key={j}>{seg}</Fragment>
              ),
            )}
          </Fragment>
        ),
      )}
    </>
  );
}
