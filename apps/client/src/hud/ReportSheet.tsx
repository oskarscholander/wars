import { useEffect, useRef } from "react";
import type { DiffFile, DiffLine } from "@ww/shared";
import { useStore } from "../store.ts";
import { frontLabel } from "../world/look.ts";

const lineNo = (l: DiffLine) => l.newLine ?? l.oldLine ?? 0;
const SIGN = { add: "+", del: "−", context: " " } as const;

function FileDiff({ file, onLine }: { file: DiffFile; onLine: (line: number) => void }) {
  return (
    <section>
      <div className="file">
        <span>{file.oldPath ? `${file.oldPath} → ${file.path}` : file.path}</span>
        <span className="counts">
          <span className="add">+{file.added}</span> <span className="del">−{file.removed}</span>
        </span>
      </div>
      {file.binary && <p className="note">Binary file</p>}
      {file.hunks.map((h) => (
        <div key={h.header} className="hunk">
          <div className="hunk-head">{h.header}</div>
          {h.lines.map((l, i) => (
            <button
              key={i}
              className={l.kind}
              onClick={() => onLine(lineNo(l))}
              aria-label={`Comment on ${file.path} line ${lineNo(l)}`}
            >
              <span className="n">{l.oldLine ?? ""}</span>
              <span className="n">{l.newLine ?? ""}</span>
              <span className="sign">{SIGN[l.kind]}</span>
              {l.text}
            </button>
          ))}
        </div>
      ))}
    </section>
  );
}

/** Field report: the front's diff. Tapping a line starts a review comment for the selected unit. */
export function ReportSheet() {
  const frontId = useStore((s) => s.reportFor);
  const front = useStore((s) => (s.reportFor ? s.war.fronts[s.reportFor] : undefined));
  const files = useStore((s) => (s.reportFor ? s.war.diffs[s.reportFor] : undefined));
  const unit = useStore((s) => (s.selectedUnitId ? s.war.units[s.selectedUnitId] : undefined));
  const { closeReport, setDraft, approve } = useStore.getState();
  const firstButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!frontId) return;
    const opener = document.activeElement as HTMLElement | null;
    firstButton.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeReport();
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [frontId, closeReport]);

  if (!frontId || !front) return null;
  const canComment = unit?.frontId === frontId;

  const comment = (path: string, line: number) => {
    closeReport();
    setDraft(`On ${path}:${line}: `, true);
  };

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" onClick={closeReport}>
      <div className="inner" onClick={(e) => e.stopPropagation()}>
        <h3 id="sheetTitle">Field report · {frontLabel(front)}</h3>
        <p>
          {canComment
            ? `Tap a line to comment on it. Your comment becomes ${unit!.name}'s next order.`
            : "Select a unit on this front to send line comments as orders."}
        </p>
        <div className="diff">
          {!files ? (
            <p className="note">Loading…</p>
          ) : files.length === 0 ? (
            <p className="note">No changes since this branch left main.</p>
          ) : (
            files.map((f) => (
              <FileDiff key={f.path} file={f} onLine={(line) => canComment && comment(f.path, line)} />
            ))
          )}
        </div>
        <div className="sheet-acts">
          <button ref={firstButton} className="btn go" onClick={() => approve(frontId)} disabled={!files?.length}>
            Approve
          </button>
          <button
            className="btn no"
            disabled={!canComment}
            onClick={() => {
              closeReport();
              setDraft("Please change: ", true);
            }}
          >
            Request changes
          </button>
          <button className="btn plain" onClick={closeReport}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
