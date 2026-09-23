import { useState, type FormEvent } from "react";
import { useStore } from "../store.ts";
import { frontLabel } from "../world/look.ts";

/** Bottom radio panel. In milestone 1 it describes the selected front and opens new ones. */
export function Panel() {
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const selected = useStore((s) => (s.selectedFrontId ? s.war.fronts[s.selectedFrontId] : undefined));
  const send = useStore((s) => s.send);
  const [branch, setBranch] = useState("");

  const count = Object.keys(war.fronts).length;
  const online = connection === "open";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = branch.trim();
    if (!name) return;
    if (send({ type: "front.create", branch: name })) setBranch("");
  };

  return (
    <section className="panel" aria-label="Orders">
      {selected ? (
        <div className="unit">
          <div>
            <h2>{frontLabel(selected)}</h2>
            <span className="kind">{selected.path}</span>
          </div>
          <div className="stats">
            <span>{selected.head.slice(0, 7)}</span>
            {selected.locked && <span>locked</span>}
            {selected.prunable && <span className="fail">prunable</span>}
          </div>
        </div>
      ) : (
        <p className="idle-msg">
          {!online
            ? "Waiting for the daemon. Start it with pnpm dev."
            : count
              ? "Each island is a worktree. Tap one to focus it."
              : "No worktrees yet. Open a front to create one."}
        </p>
      )}

      <div className="hints">
        <button disabled title="Arrives in milestone 2">
          Deploy a unit here
        </button>
      </div>

      <form className="say" onSubmit={submit} autoComplete="off">
        <div className="field">
          <input
            aria-label="New branch name"
            placeholder="New front: branch name, e.g. feat/comments"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            disabled={!online}
            spellCheck={false}
          />
        </div>
        <button className="send" type="submit" disabled={!online || !branch.trim()}>
          Open front
        </button>
      </form>
    </section>
  );
}
