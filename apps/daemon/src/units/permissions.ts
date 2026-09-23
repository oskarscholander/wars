import { randomUUID } from "node:crypto";
import type { PermissionRequest } from "@ww/shared";
import type { Store } from "../store.ts";
import { summarizeTool } from "./summary.ts";

/** Tools that never need a human: they cannot change anything. */
export const AUTO_ALLOWED = new Set(["Read", "Glob", "Grep"]);

export type Decision = { allow: true } | { allow: false; message: string };

interface Pending {
  request: PermissionRequest;
  resolve: (d: Decision) => void;
}

/**
 * The one queue every permission request from every worktree goes through.
 * A request pauses its session (unit status `waiting`) until the client
 * answers, or until the session's query is aborted.
 */
export class PermissionQueue {
  #pending = new Map<string, Pending>();

  constructor(private store: Store) {}

  async request(
    unitId: string,
    tool: string,
    input: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<Decision> {
    if (AUTO_ALLOWED.has(tool)) return { allow: true };
    const unit = this.store.state.units[unitId];
    if (!unit) return { allow: false, message: "Unit no longer exists" };
    if (signal?.aborted) return { allow: false, message: "Aborted" };

    const request: PermissionRequest = {
      id: randomUUID(),
      unitId,
      frontId: unit.frontId,
      tool,
      input,
      summary: summarizeTool(tool, input, this.store.state.fronts[unit.frontId]?.path),
      createdAt: Date.now(),
    };

    return new Promise<Decision>((resolve) => {
      const onAbort = () => this.#settle(request.id, { allow: false, message: "Aborted" });
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(request.id, {
        request,
        resolve: (d) => {
          signal?.removeEventListener("abort", onAbort);
          resolve(d);
        },
      });
      this.store.emit({ type: "permission.request", request });
      this.store.emit({ type: "unit.status", unitId, status: "waiting" });
    });
  }

  /** Returns false when the id is unknown (already answered or aborted). */
  resolve(id: string, allow: boolean, message?: string): boolean {
    return this.#settle(id, allow ? { allow: true } : { allow: false, message: message || "The user denied this." });
  }

  /** Denies everything a unit is waiting on, e.g. when its front disappears. */
  cancelUnit(unitId: string): void {
    for (const p of [...this.#pending.values()]) {
      if (p.request.unitId === unitId) this.#settle(p.request.id, { allow: false, message: "Cancelled" });
    }
  }

  #settle(id: string, decision: Decision): boolean {
    const p = this.#pending.get(id);
    if (!p) return false;
    this.#pending.delete(id);
    const { unitId } = p.request;
    this.store.emit({ type: "permission.resolved", id, allow: decision.allow });
    const stillWaiting = [...this.#pending.values()].some((q) => q.request.unitId === unitId);
    if (!stillWaiting && this.store.state.units[unitId]?.status === "waiting") {
      this.store.emit({ type: "unit.status", unitId, status: "working" });
    }
    p.resolve(decision);
    return true;
  }
}
