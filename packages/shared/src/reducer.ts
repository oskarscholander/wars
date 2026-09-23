import type { ServerEvent } from "./protocol.ts";
import type { WarState } from "./types.ts";
import { emptyState } from "./types.ts";

const without = <T>(rec: Record<string, T>, key: string): Record<string, T> => {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
};

function removeFront(state: WarState, frontId: string): WarState {
  const units = Object.fromEntries(Object.entries(state.units).filter(([, u]) => u.frontId !== frontId));
  const permissions = Object.fromEntries(Object.entries(state.permissions).filter(([, p]) => p.frontId !== frontId));
  return { ...state, fronts: without(state.fronts, frontId), units, permissions, diffs: without(state.diffs, frontId) };
}

/**
 * Applies one daemon event. The daemon runs its own state through this same
 * function before broadcasting, so snapshot + events always equals daemon state.
 * Events for unknown fronts/units are ignored rather than inventing records.
 */
export function applyEvent(state: WarState, ev: ServerEvent): WarState {
  switch (ev.type) {
    case "state.snapshot":
      return ev.state;

    case "repo.upserted":
      return { ...state, repos: { ...state.repos, [ev.repo.id]: ev.repo } };

    case "repo.removed": {
      const gone = Object.values(state.fronts).filter((f) => f.repoId === ev.repoId);
      const next = gone.reduce((s, f) => removeFront(s, f.id), state);
      return { ...next, repos: without(next.repos, ev.repoId) };
    }

    case "repo.suggestions":
      return state;

    case "front.upserted":
      if (!state.repos[ev.front.repoId]) return state;
      return { ...state, fronts: { ...state.fronts, [ev.front.id]: ev.front } };

    case "front.removed":
      return removeFront(state, ev.frontId);

    case "unit.upserted":
      if (!state.fronts[ev.unit.frontId]) return state;
      return { ...state, units: { ...state.units, [ev.unit.id]: ev.unit } };

    case "unit.removed": {
      const permissions = Object.fromEntries(
        Object.entries(state.permissions).filter(([, p]) => p.unitId !== ev.unitId),
      );
      return { ...state, units: without(state.units, ev.unitId), permissions };
    }

    case "unit.status": {
      const unit = state.units[ev.unitId];
      if (!unit) return state;
      return { ...state, units: { ...state.units, [unit.id]: { ...unit, status: ev.status } } };
    }

    case "unit.text": {
      const unit = state.units[ev.unitId];
      if (!unit) return state;
      const reply = unit.replyId === ev.messageId ? unit.reply + ev.delta : ev.delta;
      return { ...state, units: { ...state.units, [unit.id]: { ...unit, replyId: ev.messageId, reply } } };
    }

    case "unit.tool":
      // Drives animation only; no state change.
      return state;

    case "permission.request":
      if (!state.units[ev.request.unitId]) return state;
      return { ...state, permissions: { ...state.permissions, [ev.request.id]: ev.request } };

    case "permission.resolved":
      return { ...state, permissions: without(state.permissions, ev.id) };

    case "diff.updated":
      if (!state.fronts[ev.frontId]) return state;
      return { ...state, diffs: { ...state.diffs, [ev.frontId]: ev.files } };

    case "tests.result": {
      const front = state.fronts[ev.frontId];
      if (!front) return state;
      return { ...state, fronts: { ...state.fronts, [front.id]: { ...front, tests: ev.tests } } };
    }

    case "pr.opened": {
      const front = state.fronts[ev.frontId];
      if (!front) return state;
      const pr = { number: ev.number, url: ev.url, state: "open" as const };
      return { ...state, fronts: { ...state.fronts, [front.id]: { ...front, pr } } };
    }

    case "pr.merged": {
      const front = state.fronts[ev.frontId];
      if (!front?.pr) return state;
      const pr = { ...front.pr, state: "merged" as const };
      return { ...state, fronts: { ...state.fronts, [front.id]: { ...front, pr } } };
    }

    case "error":
      return state;
  }
}

export const replay = (events: ServerEvent[], from: WarState = emptyState()): WarState =>
  events.reduce(applyEvent, from);
