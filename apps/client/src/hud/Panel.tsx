import { useState, type FormEvent } from "react";
import { UNIT_MODELS, type Unit, type UnitModel } from "@ww/shared";
import { unitsOnFront, useStore } from "../store.ts";
import { frontLabel } from "../world/look.ts";
import { UNIT_KIND } from "../world/UnitModels.tsx";

const QUICK_ORDERS = ["Report what you changed", "Run the tests", "Commit your work"];
const DEFAULT_NAME: Record<UnitModel, string> = { opus: "Tank", sonnet: "Squad", haiku: "Scout" };

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function UnitHeader({ unit, branch }: { unit: Unit; branch: string }) {
  return (
    <div className="unit">
      <div>
        <h2>{unit.name}</h2>
        <span className="kind">
          {UNIT_KIND[unit.model]} on {branch}
        </span>
      </div>
      <div className="stats">
        <span>{unit.filesChanged} files</span>
        <span>{fmtTokens(unit.inputTokens + unit.outputTokens)} tokens</span>
        <span>${unit.costUsd.toFixed(2)}</span>
        {unit.queuedOrders > 0 && <span>{unit.queuedOrders} queued</span>}
      </div>
    </div>
  );
}

/** Bottom radio panel: orders for the selected unit, deploying on the selected front, new fronts otherwise. */
export function Panel() {
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const front = useStore((s) => (s.selectedFrontId ? s.war.fronts[s.selectedFrontId] : undefined));
  const unit = useStore((s) => (s.selectedUnitId ? s.war.units[s.selectedUnitId] : undefined));
  const deployingOn = useStore((s) => s.deployingOn);
  const { send, deploy, selectUnit } = useStore.getState();
  const [text, setText] = useState("");
  const [model, setModel] = useState<UnitModel>("sonnet");
  const online = connection === "open";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const ok = unit
      ? send({ type: "unit.order", unitId: unit.id, text: value })
      : front
        ? (deploy(front.id, model, value), true)
        : send({ type: "front.create", branch: value });
    if (ok) setText("");
  };

  const deployDefault = () => {
    if (!front) return;
    const n = unitsOnFront(war, front.id).filter((u) => u.model === model).length + 1;
    deploy(front.id, model, `${DEFAULT_NAME[model]} ${n}`);
  };

  let header;
  if (unit && front) header = <UnitHeader unit={unit} branch={frontLabel(front)} />;
  else if (front)
    header = (
      <div className="unit">
        <div>
          <h2>{frontLabel(front)}</h2>
          <span className="kind">{front.path}</span>
        </div>
        <div className="stats">
          <span>{front.head.slice(0, 7)}</span>
          {front.locked && <span>locked</span>}
          {front.prunable && <span className="fail">prunable</span>}
        </div>
      </div>
    );
  else
    header = (
      <p className="idle-msg">
        {!online
          ? "Waiting for the daemon. Start it with pnpm dev."
          : Object.keys(war.fronts).length
            ? "Each island is a worktree and each unit is an agent. Tap an island to deploy, or a unit to give it orders."
            : "No worktrees yet. Open a front to create one."}
      </p>
    );

  const placeholder = unit
    ? `Radio ${unit.name}…`
    : front
      ? `Name the new ${UNIT_KIND[model].split(" · ")[1]}, or tap Deploy`
      : "New front: branch name, e.g. feat/comments";

  return (
    <section className="panel" aria-label="Orders">
      {header}

      <div className="hints">
        {unit &&
          QUICK_ORDERS.map((o) => (
            <button key={o} disabled={!online} onClick={() => send({ type: "unit.order", unitId: unit.id, text: o })}>
              {o}
            </button>
          ))}
        {!unit && front && (
          <>
            {unitsOnFront(war, front.id).map((u) => (
              <button key={u.id} className={`unitchip ${u.status}`} onClick={() => selectUnit(u.id)}>
                {u.name}
              </button>
            ))}
            <div className="seg" role="radiogroup" aria-label="Unit type">
              {UNIT_MODELS.map((m) => (
                <button key={m} role="radio" aria-checked={model === m} onClick={() => setModel(m)}>
                  {UNIT_KIND[m]}
                </button>
              ))}
            </div>
            <button className="deploy" disabled={!online || deployingOn === front.id} onClick={deployDefault}>
              Deploy a unit here
            </button>
          </>
        )}
      </div>

      <form className="say" onSubmit={submit} autoComplete="off">
        <div className="field">
          <input
            aria-label={unit ? "Order" : front ? "Unit name" : "New branch name"}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!online}
            spellCheck={!!unit}
          />
        </div>
        <button className="send" type="submit" disabled={!online || !text.trim()}>
          {unit ? "Send" : front ? "Deploy" : "Open front"}
        </button>
      </form>
    </section>
  );
}
