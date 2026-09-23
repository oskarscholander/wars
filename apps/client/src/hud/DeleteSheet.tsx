import { useEffect, useRef } from "react";
import { frontTitle, unitsOnFront, useStore } from "../store.ts";

/** Confirm deleting a worktree. Git refuses dirty worktrees; then we offer a forced delete. */
export function DeleteSheet() {
  const deleting = useStore((s) => s.deleting);
  const war = useStore((s) => s.war);
  const { closeDelete, confirmDelete, setDeleteBranch } = useStore.getState();
  const cancel = useRef<HTMLButtonElement>(null);
  const open = !!deleting;

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    cancel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && closeDelete();
    addEventListener("keydown", onKey);
    return () => {
      removeEventListener("keydown", onKey);
      opener?.focus?.();
    };
  }, [open, closeDelete]);

  if (!deleting) return null;
  const front = war.fronts[deleting.frontId];
  if (!front) return null;
  const units = unitsOnFront(war, front.id);
  const { stage, pending } = deleting;

  return (
    <div className="sheet" role="alertdialog" aria-modal="true" aria-labelledby="deleteTitle" onClick={closeDelete}>
      <div className="inner delete" onClick={(e) => e.stopPropagation()}>
        <h3 id="deleteTitle">Delete {frontTitle(war, front)}?</h3>
        <p className="path">{front.path}</p>
        <ul className="delete-facts">
          <li>Runs git worktree remove: the folder is deleted, commits on the branch are kept.</li>
          {units.length > 0 && (
            <li>
              {units.length} unit{units.length === 1 ? "" : "s"} ({units.map((u) => u.name).join(", ")}) will be stopped and
              forgotten.
            </li>
          )}
          {front.pr?.state === "open" && <li>PR #{front.pr.number} stays open on GitHub.</li>}
        </ul>

        {stage === "dirty" && (
          <p className="warn" role="alert">
            {deleting.note ?? "This worktree has uncommitted or untracked changes."} Deleting anyway throws them away.
          </p>
        )}
        {stage === "locked" && (
          <p className="warn" role="alert">
            {deleting.note}
          </p>
        )}

        {front.branch && stage !== "locked" && (
          <label className="check">
            <input
              type="checkbox"
              checked={deleting.deleteBranch}
              onChange={(e) => setDeleteBranch(e.target.checked)}
              disabled={pending}
            />
            Also delete branch <code>{front.branch}</code> if it's merged
          </label>
        )}

        <div className="sheet-acts">
          {stage === "confirm" && (
            <button className="btn danger" onClick={() => confirmDelete(false)} disabled={pending}>
              {pending ? "Deleting…" : "Delete worktree"}
            </button>
          )}
          {stage === "dirty" && (
            <button className="btn danger" onClick={() => confirmDelete(true)} disabled={pending}>
              {pending ? "Deleting…" : "Delete anyway"}
            </button>
          )}
          <button ref={cancel} className="btn plain" onClick={closeDelete}>
            {stage === "locked" ? "Close" : "Cancel"}
          </button>
        </div>
      </div>
    </div>
  );
}
