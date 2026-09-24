import { randomUUID } from "node:crypto";
import type { Options, SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { Front, ImageAttachment, PermissionMode, Unit, UnitModel } from "@ww/shared";
import type { Db } from "../db.ts";
import type { Store } from "../store.ts";
import { TurnMapper, type Effect } from "./mapMessage.ts";
import type { PermissionQueue } from "./permissions.ts";
import type { UnitLog } from "./log.ts";

export type QueryFn = (params: { prompt: string | AsyncIterable<SDKUserMessage>; options: Options }) => AsyncIterable<SDKMessage>;

interface Order {
  text: string;
  images?: ImageAttachment[];
}

/** A plain string when there are no images (keeps the common path simple); a one-shot
 * async generator of a single content-block user message when there are. */
function buildPrompt(order: Order): string | AsyncIterable<SDKUserMessage> {
  if (!order.images || order.images.length === 0) return order.text;
  const content: SDKUserMessage["message"]["content"] = [
    ...order.images.map((img) => ({ type: "image" as const, source: { type: "base64" as const, media_type: img.mediaType, data: img.data } })),
    ...(order.text ? [{ type: "text" as const, text: order.text }] : []),
  ];
  return (async function* () {
    yield { type: "user", message: { role: "user", content }, parent_tool_use_id: null } satisfies SDKUserMessage;
  })();
}

export interface UnitManagerDeps {
  store: Store;
  db: Db;
  permissions: PermissionQueue;
  queryFn: QueryFn;
  changedFiles: (front: Front) => Promise<number>;
  /** Optional passthrough; by default the SDK uses the user's `claude login`. */
  anthropicApiKey?: string;
  /** Terminal transcript; optional so tests can leave it out. */
  transcript?: UnitLog;
  /** Permission mode for new units. Defaults to auto. */
  defaultPermissionMode?: PermissionMode;
  log?: (msg: string) => void;
}

type ResultEffect = Extract<Effect, { kind: "result" }>;

const bubbleBrief = (front: Front) =>
  [
    `You are a unit in Worktree Wars, working in the git worktree at ${front.path}` +
      (front.branch ? ` on branch ${front.branch}.` : "."),
    "Your replies appear in a small speech bubble above you: keep them short and lead with the outcome.",
  ].join(" ");

/**
 * Owns every unit's Claude Agent SDK session: one active query per unit,
 * later orders queue behind it, and sessions resume by id across restarts.
 */
export class UnitManager {
  #deps: UnitManagerDeps;
  #queues = new Map<string, Order[]>();
  #running = new Set<string>();
  #aborts = new Map<string, AbortController>();
  #loadedFronts = new Set<string>();

  constructor(deps: UnitManagerDeps) {
    this.#deps = deps;
    deps.store.subscribe((ev) => {
      // Deferred so our events reach clients after the event that caused them.
      if (ev.type === "front.upserted") queueMicrotask(() => this.#loadFront(ev.front.id));
      if (ev.type === "front.removed") {
        this.#loadedFronts.delete(ev.frontId);
        for (const [unitId, ac] of this.#aborts) {
          if (!deps.store.state.units[unitId]) ac.abort();
        }
      }
    });
    for (const id of Object.keys(deps.store.state.fronts)) this.#loadFront(id);
  }

  create(frontId: string, model: UnitModel, name: string, permissionMode?: PermissionMode): Unit {
    const { store, db } = this.#deps;
    if (!store.state.fronts[frontId]) throw new UnitError("That front no longer exists");
    const unit: Unit = {
      id: randomUUID(),
      frontId,
      name: name.trim().slice(0, 80) || "Unit",
      model,
      status: "idle",
      activePermissionMode: null,
      permissionMode: permissionMode ?? this.#deps.defaultPermissionMode ?? "auto",
      sessionId: null,
      turns: 0,
      filesChanged: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      queuedOrders: 0,
      replyId: null,
      reply: "",
      createdAt: Date.now(),
    };
    db.saveUnit(unit);
    store.emit({ type: "unit.upserted", unit });
    return unit;
  }

  order(unitId: string, text: string, images?: ImageAttachment[]): void {
    if (!this.#deps.store.state.units[unitId]) throw new UnitError("That unit no longer exists");
    this.#deps.transcript?.add(unitId, "order", text, { ...(images?.length ? { images } : {}) });
    const queue = this.#queues.get(unitId) ?? [];
    queue.push({ text, ...(images?.length ? { images } : {}) });
    this.#queues.set(unitId, queue);
    if (this.#running.has(unitId)) {
      this.#patch(unitId, { queuedOrders: queue.length });
    } else {
      void this.#run(unitId);
    }
  }

  /** Changes how a unit's tool use is approved; takes effect from its next order. */
  setPermissionMode(unitId: string, permissionMode: PermissionMode): void {
    if (!this.#deps.store.state.units[unitId]) throw new UnitError("That unit no longer exists");
    this.#patch(unitId, { permissionMode, activePermissionMode: null });
  }

  /** Dismisses a unit: stops its work and removes it. */
  dismiss(unitId: string): void {
    const { store, db } = this.#deps;
    const unit = store.state.units[unitId];
    if (!unit) throw new UnitError("That unit no longer exists");
    this.#queues.delete(unitId);
    this.#aborts.get(unitId)?.abort();
    this.#deps.permissions.cancelUnit(unitId);
    db.deleteUnit(unitId);
    store.emit({ type: "unit.removed", unitId });
  }

  /** Stops a front's units before its worktree is deleted: aborts queries, drops queued orders. */
  stopFront(frontId: string): void {
    for (const unit of Object.values(this.#deps.store.state.units)) {
      if (unit.frontId !== frontId) continue;
      this.#queues.delete(unit.id);
      this.#aborts.get(unit.id)?.abort();
      this.#deps.permissions.cancelUnit(unit.id);
    }
  }

  /** Aborts every running query, e.g. on shutdown. */
  stopAll(): void {
    for (const ac of this.#aborts.values()) ac.abort();
  }

  #loadFront(frontId: string): void {
    const { store, db } = this.#deps;
    if (this.#loadedFronts.has(frontId) || !store.state.fronts[frontId]) return;
    this.#loadedFronts.add(frontId);
    for (const stored of db.unitsForFront(frontId)) {
      if (store.state.units[stored.id]) continue;
      store.emit({ type: "unit.upserted", unit: { ...stored, status: "idle", queuedOrders: 0, activePermissionMode: null } });
    }
  }

  async #run(unitId: string): Promise<void> {
    const { store } = this.#deps;
    this.#running.add(unitId);
    let ok = true;
    try {
      const queue = this.#queues.get(unitId) ?? [];
      let order: Order | undefined;
      while ((order = queue.shift()) !== undefined) {
        if (!store.state.units[unitId]) break;
        // A fresh order clears the bubble so the last turn's reply doesn't linger beside "working".
        this.#patch(unitId, { queuedOrders: queue.length, status: "working", replyId: null, reply: "" });
        ok = await this.#turn(unitId, order);
      }
    } finally {
      this.#running.delete(unitId);
      this.#queues.delete(unitId);
      if (store.state.units[unitId]) this.#patch(unitId, { status: ok ? "idle" : "error", queuedOrders: 0 });
    }
  }

  /** Runs one order to completion. Returns whether it succeeded. */
  async #turn(unitId: string, order: Order, retried = false): Promise<boolean> {
    const { store, permissions, queryFn, anthropicApiKey } = this.#deps;
    const unit = store.state.units[unitId];
    const front = unit && store.state.fronts[unit.frontId];
    if (!unit || !front) return false;

    const ac = new AbortController();
    this.#aborts.set(unitId, ac);
    const started = Date.now();
    const mapper = new TurnMapper(front.path);
    let result: ResultEffect | null = null;

    try {
      const q = queryFn({
        prompt: buildPrompt(order),
        options: {
          cwd: front.path,
          model: unit.model,
          // Auto: the classifier approves safe actions itself and only escalates the rest to canUseTool.
          permissionMode: unit.permissionMode,
          ...(unit.sessionId ? { resume: unit.sessionId } : {}),
          includePartialMessages: true,
          abortController: ac,
          systemPrompt: { type: "preset", preset: "claude_code", append: bubbleBrief(front) },
          canUseTool: async (tool, input, { signal }) => {
            const d = await permissions.request(unitId, tool, input, signal);
            return d.allow ? { behavior: "allow", updatedInput: input } : { behavior: "deny", message: d.message };
          },
          ...(anthropicApiKey ? { env: { ...process.env, ANTHROPIC_API_KEY: anthropicApiKey } } : {}),
        },
      });
      for await (const msg of q) {
        for (const e of mapper.map(msg)) {
          if (e.kind === "result") result = e;
          else this.#applyEffect(unitId, e);
        }
      }
    } catch (err) {
      if (ac.signal.aborted) return false;
      const message = err instanceof Error ? err.message : String(err);
      // A session id from another machine or a wiped ~/.claude: start fresh once.
      if (!retried && unit.sessionId && /no conversation found|session.*not found/i.test(message)) {
        this.#patch(unitId, { sessionId: null });
        return this.#turn(unitId, order, true);
      }
      this.#deps.log?.(`unit ${unitId} query failed: ${message}`);
      result = { kind: "result", ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, errorText: message };
    } finally {
      this.#aborts.delete(unitId);
      permissions.cancelUnit(unitId);
    }

    const current = store.state.units[unitId];
    if (!current) return false;
    if (!result) result = { kind: "result", ok: false, costUsd: 0, inputTokens: 0, outputTokens: 0, errorText: "The session ended without a result." };
    if (result.errorText && !result.ok) {
      store.emit({ type: "unit.text", unitId, messageId: `error-${randomUUID()}`, delta: `Error: ${result.errorText}` });
    }

    let filesChanged = current.filesChanged;
    try {
      filesChanged = await this.#deps.changedFiles(front);
    } catch {
      // keep the previous count
    }
    const after = store.state.units[unitId];
    if (!after) return false;
    const transcript = this.#deps.transcript;
    if (transcript) {
      transcript.flush(unitId);
      const secs = Math.max(1, Math.round((Date.now() - started) / 1000));
      const spent = Math.max(0, result.costUsd - after.costUsd);
      transcript.add(unitId, "result", `${result.ok ? "Done" : "Stopped"} · ${secs}s${spent ? ` · $${spent.toFixed(2)}` : ""} · ${filesChanged} file${filesChanged === 1 ? "" : "s"} changed`);
    }
    this.#patch(unitId, {
      turns: after.turns + 1,
      filesChanged,
      costUsd: Math.max(after.costUsd, result.costUsd),
      inputTokens: after.inputTokens + result.inputTokens,
      outputTokens: after.outputTokens + result.outputTokens,
    });
    return result.ok;
  }

  #applyEffect(unitId: string, e: Exclude<Effect, ResultEffect>): void {
    const { store } = this.#deps;
    switch (e.kind) {
      case "session": {
        const u = store.state.units[unitId];
        if (u && (u.sessionId !== e.sessionId || u.activePermissionMode !== e.permissionMode)) {
          this.#patch(unitId, { sessionId: e.sessionId, activePermissionMode: e.permissionMode });
        }
        return;
      }
      case "text":
        store.emit({ type: "unit.text", unitId, messageId: e.messageId, delta: e.delta });
        return;
      case "tool":
        store.emit({ type: "unit.tool", unitId, tool: e.tool, summary: e.summary });
        return;
    }
  }

  /** Emits the updated unit and persists the durable fields. */
  #patch(unitId: string, patch: Partial<Unit>): void {
    const { store, db } = this.#deps;
    const unit = store.state.units[unitId];
    if (!unit) return;
    const next = { ...unit, ...patch };
    store.emit({ type: "unit.upserted", unit: next });
    db.saveUnit(next);
  }
}

export class UnitError extends Error {}
