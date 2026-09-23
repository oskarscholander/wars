import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { LogEntry, Unit } from "@ww/shared";
import { pendingFor, unitsOnFront, useStore } from "../store.ts";
import { UNIT_KIND } from "../world/UnitModels.tsx";
import { RichText } from "./RichText.tsx";
import { terminalColumnWidth } from "./layout.ts";

const STATUS_LABEL: Record<Unit["status"], string> = { idle: "idle", working: "working", waiting: "needs you", error: "error" };

function Line({ e }: { e: LogEntry }) {
  switch (e.kind) {
    case "order":
      return (
        <div className="t-order">
          <span className="t-prompt">›</span> {e.text}
        </div>
      );
    case "assistant":
      return e.text ? (
        <div className="t-assistant">
          <RichText text={e.text} />
        </div>
      ) : null;
    case "tool":
      return (
        <div className="t-tool">
          <span className="t-dot">⏺</span> <b>{e.tool}</b> {e.text}
        </div>
      );
    case "permission":
      return (
        <div className="t-perm">
          ? {e.tool} wants: <code>{e.text}</code>
        </div>
      );
    case "decision":
      return <div className={`t-decision ${e.text.startsWith("Allowed") ? "ok" : "no"}`}>{e.text}</div>;
    case "error":
      return <div className="t-error">✕ {e.text}</div>;
    case "result":
      return <div className="t-result">— {e.text} —</div>;
  }
}

/** One agent's terminal: its transcript, inline permission prompt, and a prompt line for orders. */
export function Terminal({ unit, selected, onFocus }: { unit: Unit; selected: boolean; onFocus?: () => void }) {
  const log = useStore((s) => s.logs[unit.id]);
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const { send, loadLog } = useStore.getState();
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const [input, setInput] = useState("");
  const [recall, setRecall] = useState<number | null>(null);
  const pending = pendingFor(war, unit.id)[0];
  const online = connection === "open";

  useEffect(() => {
    if (online) loadLog(unit.id);
  }, [unit.id, online, log, loadLog]);

  // Follow new output unless the user scrolled up to read.
  useLayoutEffect(() => {
    const el = body.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [log, pending, unit.status]);

  // A terminal that needs you, or is the one you picked, comes into view.
  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId || selected) root.current?.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  }, [pendingId, selected]);

  const orders = (log ?? []).filter((e) => e.kind === "order").map((e) => e.text);

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter" && input.trim()) {
      if (send({ type: "unit.order", unitId: unit.id, text: input.trim() })) {
        setInput("");
        setRecall(null);
        stick.current = true;
      }
    } else if (ev.key === "ArrowUp" && orders.length) {
      ev.preventDefault();
      const i = recall === null ? orders.length - 1 : Math.max(0, recall - 1);
      setRecall(i);
      setInput(orders[i]!);
    } else if (ev.key === "ArrowDown" && recall !== null) {
      ev.preventDefault();
      const i = recall + 1;
      if (i >= orders.length) {
        setRecall(null);
        setInput("");
      } else {
        setRecall(i);
        setInput(orders[i]!);
      }
    }
  };

  return (
    <section ref={root} className={`terminal${selected ? " selected" : ""}`} aria-label={`${unit.name} terminal`} onMouseDown={onFocus}>
      <header>
        <span className={`t-status ${unit.status}`} aria-hidden />
        <b>{unit.name}</b>
        <span className="t-kind">{UNIT_KIND[unit.model]}</span>
        <span className="t-state">
          {STATUS_LABEL[unit.status]}
          {unit.queuedOrders > 0 ? ` · ${unit.queuedOrders} queued` : ""}
        </span>
        <span className="t-mode" title="Permission mode">
          {unit.permissionMode === "auto" ? (unit.activePermissionMode && unit.activePermissionMode !== "auto" ? "ask (auto n/a)" : "auto") : "ask"}
        </span>
      </header>
      <div
        className="t-body"
        ref={body}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {log === undefined || (log.length === 0 && !unit.turns) ? (
          <div className="t-empty">No orders yet. Type one below.</div>
        ) : (
          log.map((e) => <Line key={e.messageId ?? e.id} e={e} />)
        )}
        {unit.status === "working" && (
          <div className="t-working">
            <span className="dots" aria-label="Working">
              <span />
              <span />
              <span />
            </span>
          </div>
        )}
        {pending && (
          <div className="t-ask" role="alert">
            <div>
              <b>{pending.tool}</b> wants to run:
            </div>
            <pre>{pending.summary}</pre>
            <div className="acts">
              <button className="btn go" onClick={() => send({ type: "permission.resolve", id: pending.id, allow: true })}>
                Allow
              </button>
              <button className="btn no" onClick={() => send({ type: "permission.resolve", id: pending.id, allow: false })}>
                Deny
              </button>
            </div>
          </div>
        )}
      </div>
      <div className="t-input">
        <span className="t-prompt">›</span>
        <input
          aria-label={`Order for ${unit.name}`}
          placeholder={unit.status === "working" ? "Queue another order…" : "Give an order…"}
          value={input}
          disabled={!online}
          onChange={(e) => {
            setInput(e.target.value);
            setRecall(null);
          }}
          onKeyDown={onKey}
          spellCheck={false}
        />
      </div>
    </section>
  );
}

/**
 * Left column with a terminal per agent on the selected island (wide screens),
 * or the selected agent's terminal as a sheet (narrow screens).
 */
export function Terminals() {
  const war = useStore((s) => s.war);
  const frontId = useStore((s) => s.selectedFrontId);
  const unitId = useStore((s) => s.selectedUnitId);
  const terminalOpen = useStore((s) => s.terminalOpen);
  const { selectUnit, setTerminalOpen } = useStore.getState();
  const [width, setWidth] = useState(() => innerWidth);
  useEffect(() => {
    const on = () => setWidth(innerWidth);
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);

  const column = terminalColumnWidth(width);
  const front = frontId ? war.fronts[frontId] : undefined;

  // Publish the column width so the panel (CSS) sits beside it.
  useEffect(() => {
    document.documentElement.style.setProperty("--ww-left", `${front && column ? column : 0}px`);
  }, [front, column]);

  if (!front) return null;
  const units = unitsOnFront(war, front.id);

  if (!column) {
    const unit = unitId ? war.units[unitId] : undefined;
    if (!terminalOpen || !unit) return null;
    return (
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${unit.name} terminal`} onClick={() => setTerminalOpen(false)}>
        <div className="inner terminal-sheet" onClick={(e) => e.stopPropagation()}>
          <Terminal unit={unit} selected />
          <div className="sheet-acts">
            <button className="btn plain" onClick={() => setTerminalOpen(false)}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <aside className="terminals" style={{ width: column }} aria-label="Agent terminals">
      {units.length === 0 ? (
        <div className="terminals-empty">
          <b>No agents on this island yet.</b>
          <span>Deploy one from the panel below; its terminal appears here.</span>
        </div>
      ) : (
        units.map((u) => <Terminal key={u.id} unit={u} selected={u.id === unitId} onFocus={() => u.id !== unitId && selectUnit(u.id)} />)
      )}
    </aside>
  );
}
