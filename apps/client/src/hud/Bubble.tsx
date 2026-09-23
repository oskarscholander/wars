import { useEffect, useRef } from "react";
import { bubbleKey, overlayRef } from "../overlay.ts";
import { diffSignature, pendingFor, useStore } from "../store.ts";
import { RichText } from "./RichText.tsx";

/** The selected unit's speech bubble: streamed reply, working dots, permission prompt. */
export function Bubble() {
  const unit = useStore((s) => (s.selectedUnitId ? s.war.units[s.selectedUnitId] : undefined));
  const war = useStore((s) => s.war);
  const send = useStore((s) => s.send);
  const approved = useStore((s) => s.approved);
  const openReport = useStore((s) => s.openReport);
  const textRef = useRef<HTMLDivElement>(null);

  // Keep the newest streamed text in view.
  useEffect(() => {
    const el = textRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [unit?.reply]);

  if (!unit) return null;
  const pending = pendingFor(war, unit.id)[0];
  const working = unit.status === "working";
  const diff = war.diffs[unit.frontId];
  const pr = war.fronts[unit.frontId]?.pr;
  const canMerge = !working && !pending && pr?.state === "open";
  const showReport =
    !working && !pending && !!diff?.length && approved[unit.frontId] !== diffSignature(war, unit.frontId);

  return (
    <div className="layer" aria-live="polite">
      <div className="anchor" ref={overlayRef(bubbleKey(unit.id))}>
        <div className="bubble" role="status">
          <span className="who">{unit.name}</span>
          <div className="text" ref={textRef}>
            {unit.reply ? <RichText text={unit.reply} /> : !working && !pending ? "Awaiting orders." : null}
            {working && (
              <span className="dots" aria-label="Working">
                <span />
                <span />
                <span />
              </span>
            )}
          </div>
          {(showReport || canMerge) && (
            <div className="acts">
              {showReport && (
                <button className="btn plain" onClick={() => openReport(unit.frontId)}>
                  Open report
                </button>
              )}
              {canMerge && (
                <button className="btn gold" onClick={() => send({ type: "pr.merge", frontId: unit.frontId })}>
                  Merge PR #{pr!.number}
                </button>
              )}
            </div>
          )}
          {pending && (
            <div className="perm">
              <span className="perm-tool">{pending.tool}</span>
              <pre>{pending.summary}</pre>
              <div className="acts">
                <button className="btn go" onClick={() => send({ type: "permission.resolve", id: pending.id, allow: true })}>
                  Allow
                </button>
                <button
                  className="btn no"
                  onClick={() => send({ type: "permission.resolve", id: pending.id, allow: false })}
                >
                  Deny
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
