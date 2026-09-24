import { useEffect, useLayoutEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent, type RefObject } from "react";
import * as THREE from "three";
import type { Front, ImageAttachment, LogEntry, Unit } from "@ww/shared";
import { MAX_IMAGES_PER_ORDER } from "@ww/shared";
import { pendingFor, unitsOnFront, useStore } from "../store.ts";
import { UNIT_KIND } from "../world/UnitModels.tsx";
import { RichText } from "./RichText.tsx";
import { terminalColumnWidth } from "./layout.ts";
import { useImageAttachments } from "./attachments.ts";
import { anchors, unitAnchor } from "../overlay.ts";
import { fx } from "../world/Fx.tsx";

const imageSrc = (img: ImageAttachment) => `data:${img.mediaType};base64,${img.data}`;

/** Thumbnails for the images on an order line, or staged in the composer. */
function Thumbnails({ images, onRemove }: { images: ImageAttachment[]; onRemove?: (i: number) => void }) {
  if (!images.length) return null;
  return (
    <div className="t-thumbs">
      {images.map((img, i) => (
        <span className="t-thumb" key={i}>
          <img src={imageSrc(img)} alt="" />
          {onRemove && (
            <button type="button" aria-label="Remove image" onClick={() => onRemove(i)}>
              ×
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** The composer row: staged thumbnails, a file-picker button, and the order input. Handles paste/drop. */
function Composer({
  inputRef,
  attach,
  value,
  onChange,
  onKey,
  placeholder,
  ariaLabel,
  disabled,
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  attach: ReturnType<typeof useImageAttachments>;
  value: string;
  onChange: (v: string) => void;
  onKey: (ev: KeyboardEvent<HTMLInputElement>) => void;
  placeholder: string;
  ariaLabel: string;
  disabled: boolean;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const onPickFiles = (ev: ChangeEvent<HTMLInputElement>) => {
    if (ev.target.files) attach.addFiles(ev.target.files);
    ev.target.value = "";
  };
  return (
    <div
      className={`t-composer${dragOver ? " dragover" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        setDragOver(false);
        attach.onDrop(e);
      }}
    >
      <Thumbnails images={attach.images} onRemove={(i) => attach.removeAt(attach.images[i]!.id)} />
      {attach.error && <div className="t-attach-error">{attach.error}</div>}
      <div className="t-input">
        <button
          type="button"
          className="t-attach"
          onClick={() => fileInput.current?.click()}
          disabled={disabled || attach.images.length >= MAX_IMAGES_PER_ORDER}
          aria-label="Attach an image"
          title="Attach an image"
        >
          +
        </button>
        <input ref={fileInput} type="file" accept="image/*" multiple hidden onChange={onPickFiles} />
        <span className="t-prompt">›</span>
        <input
          ref={inputRef}
          aria-label={ariaLabel}
          placeholder={placeholder}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onPaste={attach.onPaste}
          spellCheck={false}
        />
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<Unit["status"], string> = { idle: "idle", working: "working", waiting: "needs you", error: "error" };

function Line({ e }: { e: LogEntry }) {
  switch (e.kind) {
    case "order":
      return (
        <div className="t-order">
          <span className="t-prompt">›</span> {e.text}
          {e.images && <Thumbnails images={e.images} />}
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

const reducedMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The selected terminal's prompt takes focus whenever a selection asks for it. */
function useAutoFocus(on: boolean) {
  const input = useRef<HTMLInputElement>(null);
  const tick = useStore((s) => s.terminalFocusTick);
  useEffect(() => {
    if (on) input.current?.focus({ preventScroll: true });
  }, [on, tick]);
  return input;
}

function FullButton({ full, onToggle }: { full: boolean; onToggle: () => void }) {
  return (
    <button className="t-full" onClick={onToggle} aria-label={full ? "Exit fullscreen" : "Fullscreen"} title={full ? "Exit fullscreen (Esc)" : "Fullscreen"}>
      {full ? "⤡" : "⤢"}
    </button>
  );
}

/** One agent's terminal: its transcript, inline permission prompt, and a prompt line for orders. */
export function Terminal({
  unit,
  selected,
  onFocus,
  full = false,
  onToggleFull,
}: {
  unit: Unit;
  selected: boolean;
  onFocus?: () => void;
  full?: boolean;
  onToggleFull?: () => void;
}) {
  const log = useStore((s) => s.logs[unit.id]);
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const { send, loadLog } = useStore.getState();
  const body = useRef<HTMLDivElement>(null);
  const root = useRef<HTMLElement>(null);
  const stick = useRef(true);
  const inputRef = useAutoFocus(selected || full);
  const [input, setInput] = useState("");
  const [recall, setRecall] = useState<number | null>(null);
  const attach = useImageAttachments();
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

  // When squeezed (resized), scroll to bottom to keep latest text visible.
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      if (stick.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A terminal that needs you, or is the one you picked, comes into view.
  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId || selected) root.current?.scrollIntoView({ block: "nearest", behavior: reducedMotion() ? "auto" : "smooth" });
  }, [pendingId, selected]);

  // A click anywhere in the terminal puts you at the prompt, unless it hit a control or selected text.
  const focusPrompt = (ev: MouseEvent<HTMLElement>) => {
    if ((ev.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    if (getSelection()?.toString()) return;
    inputRef.current?.focus({ preventScroll: true });
  };

  const orders = (log ?? []).filter((e) => e.kind === "order").map((e) => e.text);

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    if (ev.key === "Enter" && (input.trim() || attach.images.length)) {
      const images = attach.images.map(({ mediaType, data }): ImageAttachment => ({ mediaType, data }));
      if (send({ type: "unit.order", unitId: unit.id, text: input.trim(), ...(images.length ? { images } : {}) })) {
        setInput("");
        setRecall(null);
        attach.clear();
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
    <section ref={root} className={`terminal${selected ? " selected" : ""}${full ? " full" : ""}`} aria-label={`${unit.name} terminal`} onMouseDown={onFocus} onClick={focusPrompt}>
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
        {onToggleFull && <FullButton full={full} onToggle={onToggleFull} />}
        <button
          className="t-dismiss"
          onClick={() => {
            const key = unitAnchor(unit.id);
            const pos = anchors.get(key);
            if (pos) {
              fx.helicopter(pos);
            }
            send({ type: "unit.dismiss", unitId: unit.id });
          }}
          aria-label="Dismiss unit"
          title="Dismiss this unit (helicopter pickup)"
        >
          ⬆
        </button>
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
      <Composer
        inputRef={inputRef}
        attach={attach}
        value={input}
        onChange={(v) => {
          setInput(v);
          setRecall(null);
        }}
        onKey={onKey}
        placeholder={unit.status === "working" ? "Queue another order…" : "Give an order…"}
        ariaLabel={`Order for ${unit.name}`}
        disabled={!online}
      />
    </section>
  );
}

const DRAFT_MODEL = "sonnet" as const;

/** An island with no agents still gets a prompt: the first order deploys a squad to carry it out. */
function DraftTerminal({ front }: { front: Front }) {
  const war = useStore((s) => s.war);
  const online = useStore((s) => s.connection === "open");
  const deploying = useStore((s) => s.deployingOn === front.id);
  const [input, setInput] = useState("");
  const inputRef = useAutoFocus(true);
  const attach = useImageAttachments();

  const onKey = (ev: KeyboardEvent<HTMLInputElement>) => {
    const text = input.trim();
    if (ev.key !== "Enter" || (!text && !attach.images.length) || deploying) return;
    const n = unitsOnFront(war, front.id).filter((u) => u.model === DRAFT_MODEL).length + 1;
    const images = attach.images.map(({ mediaType, data }): ImageAttachment => ({ mediaType, data }));
    useStore.getState().deploy(front.id, DRAFT_MODEL, `Squad ${n}`, text, images);
    setInput("");
    attach.clear();
  };

  return (
    <section className="terminal selected draft" aria-label="New unit terminal" onClick={() => inputRef.current?.focus({ preventScroll: true })}>
      <header>
        <span className="t-status idle" aria-hidden />
        <b>New squad</b>
        <span className="t-kind">{UNIT_KIND[DRAFT_MODEL]}</span>
      </header>
      <div className="t-body">
        <div className="t-empty">
          {deploying ? "Deploying a squad…" : "No agents on this island yet. Give an order and a squad deploys to carry it out."}
        </div>
      </div>
      <Composer
        inputRef={inputRef}
        attach={attach}
        value={input}
        onChange={setInput}
        onKey={onKey}
        placeholder={deploying ? "Deploying…" : "Give an order…"}
        ariaLabel="First order for a new squad"
        disabled={!online || deploying}
      />
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
  const [fullId, setFullId] = useState<string | null>(null);
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

  // Esc leaves fullscreen; a fullscreen terminal whose unit left the island closes.
  const full = fullId && front && war.units[fullId]?.frontId === front.id ? fullId : null;
  useEffect(() => {
    if (!full) return;
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && setFullId(null);
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [full]);

  if (!front) return null;
  const units = unitsOnFront(war, front.id);

  if (!column) {
    const unit = unitId ? war.units[unitId] : undefined;
    if (!terminalOpen || (!unit && units.length)) return null;
    return (
      <div className="sheet" role="dialog" aria-modal="true" aria-label={`${unit?.name ?? "New squad"} terminal`} onClick={() => setTerminalOpen(false)}>
        <div className="inner terminal-sheet" onClick={(e) => e.stopPropagation()}>
          {unit ? <Terminal unit={unit} selected /> : <DraftTerminal front={front} />}
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
    <aside className={`terminals${full ? " has-full" : ""}`} style={{ width: column }} aria-label="Agent terminals">
      {units.length === 0 ? (
        <DraftTerminal front={front} />
      ) : (
        units.map((u) => (
          <Terminal
            key={u.id}
            unit={u}
            selected={u.id === unitId}
            onFocus={() => u.id !== unitId && selectUnit(u.id)}
            full={u.id === full}
            onToggleFull={() => setFullId(u.id === full ? null : u.id)}
          />
        ))
      )}
      {full && <div className="terminal-backdrop" onClick={() => setFullId(null)} aria-hidden />}
    </aside>
  );
}
