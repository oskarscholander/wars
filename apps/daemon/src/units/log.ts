import type { LogEntry } from "@ww/shared";
import type { Db } from "../db.ts";
import type { Store } from "../store.ts";

/**
 * Each unit's terminal transcript. Records orders, streamed assistant text,
 * tool calls, permission prompts and decisions, errors and turn results;
 * persists them and broadcasts each new line as `unit.entry`. Assistant lines
 * grow through the `unit.text` deltas clients already receive.
 */
export class UnitLog {
  /** Open assistant line per unit: its id, message and text so far. */
  #open = new Map<string, { id: number; messageId: string; text: string }>();

  constructor(
    private store: Store,
    private db: Db,
  ) {
    store.subscribe((ev) => {
      switch (ev.type) {
        case "unit.text":
          this.#text(ev.unitId, ev.messageId, ev.delta);
          return;
        case "unit.tool":
          this.#close(ev.unitId);
          this.add(ev.unitId, "tool", ev.summary, { tool: ev.tool });
          return;
        case "permission.request":
          this.add(ev.request.unitId, "permission", ev.request.summary, { tool: ev.request.tool });
          return;
        case "permission.resolved": {
          const req = this.#requests.get(ev.id);
          if (req) this.add(req.unitId, "decision", ev.allow ? `Allowed ${req.tool}` : `Denied ${req.tool}`, { tool: req.tool });
          this.#requests.delete(ev.id);
          return;
        }
      }
    });
    // Remember which unit a request belonged to; the resolved event only carries its id.
    store.subscribe((ev) => {
      if (ev.type === "permission.request") this.#requests.set(ev.request.id, { unitId: ev.request.unitId, tool: ev.request.tool });
    });
  }

  #requests = new Map<string, { unitId: string; tool: string }>();

  add(unitId: string, kind: LogEntry["kind"], text: string, extra: { tool?: string; messageId?: string } = {}): LogEntry {
    const entry = this.db.appendLog({ unitId, at: Date.now(), kind, text, ...extra });
    // Deferred so the line reaches clients after the event that caused it.
    queueMicrotask(() => this.store.emit({ type: "unit.entry", entry }));
    return entry;
  }

  /** Saves the open assistant line, e.g. at the end of a turn. */
  flush(unitId: string): void {
    this.#close(unitId);
  }

  history(unitId: string): LogEntry[] {
    const entries = this.db.logFor(unitId);
    // The open line's text lives in memory until it's closed.
    const open = this.#open.get(unitId);
    if (open) for (const e of entries) if (e.id === open.id) e.text = open.text;
    return entries;
  }

  #text(unitId: string, messageId: string, delta: string): void {
    if (messageId.startsWith("error-")) {
      this.#close(unitId);
      this.add(unitId, "error", delta.replace(/^Error:\s*/, ""), { messageId });
      return;
    }
    const open = this.#open.get(unitId);
    if (open && open.messageId === messageId) {
      open.text += delta;
      return;
    }
    this.#close(unitId);
    // The line starts empty; clients fill it from this same delta, which they receive right after.
    const entry = this.add(unitId, "assistant", "", { messageId });
    this.#open.set(unitId, { id: entry.id, messageId, text: delta });
  }

  #close(unitId: string): void {
    const open = this.#open.get(unitId);
    if (!open) return;
    this.db.updateLogText(open.id, open.text);
    this.#open.delete(unitId);
  }
}
