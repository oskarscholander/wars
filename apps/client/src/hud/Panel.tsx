import { useEffect, useRef, useState, type FormEvent } from "react";
import { UNIT_MODELS, type Front, type Unit, type UnitModel } from "@ww/shared";
import { sortedRepos, unitsOnFront, useStore } from "../store.ts";
import { frontLabel } from "../world/look.ts";
import { UNIT_KIND } from "../world/UnitModels.tsx";
import { formatAge, useNow } from "../world/age.ts";

const QUICK_ORDERS = ["Report what you changed", "Commit your work"];
const DEFAULT_NAME: Record<UnitModel, string> = { opus: "Tank", sonnet: "Squad", haiku: "Scout" };

const fmtTokens = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

function UnitHeader({ unit, front }: { unit: Unit; front: Front }) {
  return (
    <div className="unit">
      <div>
        <h2>{unit.name}</h2>
        <span className="kind">
          {UNIT_KIND[unit.model]} on {frontLabel(front)}
        </span>
      </div>
      <div className="stats">
        <TestsStat front={front} />
        <span>{unit.filesChanged} files</span>
        <span>{fmtTokens(unit.inputTokens + unit.outputTokens)} tokens</span>
        <span>${unit.costUsd.toFixed(2)}</span>
        {unit.queuedOrders > 0 && <span>{unit.queuedOrders} queued</span>}
      </div>
    </div>
  );
}

const TESTS_LABEL: Record<Front["tests"]["status"], string> = {
  unknown: "Tests not run",
  running: "Testing…",
  passed: "Tests pass",
  failed: "Tests failing",
};

function TestsStat({ front }: { front: Front }) {
  const t = front.tests;
  const counts = t.status === "passed" || t.status === "failed" ? ` ${t.passed}/${t.passed + t.failed}` : "";
  return (
    <span className={t.status === "failed" ? "fail" : t.status === "passed" ? "add" : ""} title={t.outputTail || undefined}>
      {TESTS_LABEL[t.status]}
      {counts}
    </span>
  );
}

/** Daemon-side actions for a front: tests, PR, merge. */
function ShipButtons({ front, online }: { front: Front; online: boolean }) {
  const send = useStore((s) => s.send);
  const pr = front.pr;
  const blocked = front.tests.status === "failed";
  return (
    <>
      <button disabled={!online || front.tests.status === "running"} onClick={() => send({ type: "tests.run", frontId: front.id })}>
        {front.tests.status === "running" ? "Testing…" : "Run tests"}
      </button>
      {pr?.state === "open" ? (
        <button className="gold" disabled={!online} onClick={() => send({ type: "pr.merge", frontId: front.id })}>
          Merge PR #{pr.number}
        </button>
      ) : pr?.state === "merged" ? null : (
        <button
          disabled={!online || blocked || front.tests.status === "running" || !front.branch}
          title={blocked ? "A failing-test bunker blocks the road" : undefined}
          onClick={() => send({ type: "pr.open", frontId: front.id })}
        >
          Open PR
        </button>
      )}
    </>
  );
}

/** Bottom radio panel: orders for the selected unit, deploying on the selected front, new fronts otherwise. */
export function Panel() {
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const front = useStore((s) => (s.selectedFrontId ? s.war.fronts[s.selectedFrontId] : undefined));
  const unit = useStore((s) => (s.selectedUnitId ? s.war.units[s.selectedUnitId] : undefined));
  const deployingOn = useStore((s) => s.deployingOn);
  const { send, deploy, selectUnit, setDraft, openReport } = useStore.getState();
  const text = useStore((s) => s.draft);
  const setText = (t: string) => setDraft(t);
  const focusTick = useStore((s) => s.focusTick);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focusTick) return;
    const el = input.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [focusTick]);
  const [model, setModel] = useState<UnitModel>("sonnet");
  const repos = sortedRepos(war);
  const [repoChoice, setRepoChoice] = useState<string | null>(null);
  const newFrontRepo = repos.find((r) => r.id === repoChoice) ?? repos[0];
  const openRepos = useStore((s) => s.openRepos);
  const online = connection === "open";
  const now = useNow(60_000);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim();
    if (!value) return;
    const ok = unit
      ? send({ type: "unit.order", unitId: unit.id, text: value })
      : front
        ? (deploy(front.id, model, value), true)
        : newFrontRepo
          ? send({ type: "front.create", repoId: newFrontRepo.id, branch: value })
          : (openRepos(), false);
    if (ok) setText("");
  };

  const deployDefault = () => {
    if (!front) return;
    const n = unitsOnFront(war, front.id).filter((u) => u.model === model).length + 1;
    deploy(front.id, model, `${DEFAULT_NAME[model]} ${n}`);
  };

  let header;
  if (unit && front) header = <UnitHeader unit={unit} front={front} />;
  else if (front)
    header = (
      <div className="unit">
        <div>
          <h2>{frontLabel(front)}</h2>
          <span className="kind">
            {war.repos[front.repoId]?.name} · {front.path}
          </span>
        </div>
        <div className="stats">
          <TestsStat front={front} />
          {front.pr && <span>PR #{front.pr.number} {front.pr.state}</span>}
          {formatAge(front.createdAt, now) && <span>{formatAge(front.createdAt, now)}</span>}
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
          : !repos.length
            ? "Pick the repos to monitor with Repos in the top bar."
            : Object.keys(war.fronts).length
              ? "Each island is a worktree and each unit is an agent. Tap an island to deploy, or a unit to give it orders."
              : "No worktrees yet. Open a front to create one."}
      </p>
    );

  const placeholder = unit
    ? `Radio ${unit.name}…`
    : front
      ? `Name the new ${UNIT_KIND[model].split(" · ")[1]}, or tap Deploy`
      : newFrontRepo
        ? `New front in ${newFrontRepo.name}: branch name`
        : "Add a repo first";

  return (
    <section className="panel" aria-label="Orders">
      {header}

      <div className="hints">
        {unit && (
          <>
            <button disabled={!online} onClick={() => openReport(unit.frontId)}>
              Field report
            </button>
            {front && <ShipButtons front={front} online={online} />}
            {QUICK_ORDERS.map((o) => (
              <button key={o} disabled={!online} onClick={() => send({ type: "unit.order", unitId: unit.id, text: o })}>
                {o}
              </button>
            ))}
          </>
        )}
        {!unit && front && (
          <>
            <ShipButtons front={front} online={online} />
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

      {!unit && !front && repos.length > 1 && (
        <div className="hints">
          <div className="seg" role="radiogroup" aria-label="Repo for the new front">
            {repos.map((r) => (
              <button key={r.id} role="radio" aria-checked={newFrontRepo?.id === r.id} onClick={() => setRepoChoice(r.id)}>
                {r.name}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className="say" onSubmit={submit} autoComplete="off">
        <div className="field">
          <input
            ref={input}
            aria-label={unit ? "Order" : front ? "Unit name" : "New branch name"}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!online || (!unit && !front && !newFrontRepo)}
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
