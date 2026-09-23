import { create } from "zustand";
import { emitTool } from "./events.ts";
import { applyEvent, emptyState, type ClientCommand, type Front, type RepoSuggestion, type ServerEvent, type UnitModel, type WarState } from "@ww/shared";

export type ConnectionStatus = "connecting" | "open" | "offline";

export interface Toast {
  id: number;
  message: string;
  /** Clicking the toast selects this front and flies the camera there. */
  frontId?: string;
  /** Extra link, e.g. the PR on GitHub. */
  link?: { label: string; href: string };
}

type ToastExtras = Omit<Toast, "id" | "message">;

interface ClientStore {
  /** Mirror of daemon state: only ever changed by daemon events. */
  war: WarState;
  connection: ConnectionStatus;
  /** True once the first snapshot of this connection has arrived. */
  synced: boolean;
  toast: Toast | null;
  /** UI-only selection; not part of daemon state. */
  selectedFrontId: string | null;
  selectedUnitId: string | null;
  /** Front we just asked to deploy on, so the new unit gets selected when it arrives. */
  deployingOn: string | null;
  /** Text in the radio input. Lives here so the report sheet can prefill it. */
  draft: string;
  /** Bumped to ask the radio input to take focus. */
  focusTick: number;
  /** Front whose field report sheet is open. */
  reportFor: string | null;
  /** Diff signature the user approved, per front, so "Open report" hides until it changes. */
  approved: Record<string, string>;
  reposOpen: boolean;
  /** Latest `repo.suggestions` reply; null while loading. */
  suggestions: RepoSuggestion[] | null;

  apply: (ev: ServerEvent) => void;
  setConnection: (c: ConnectionStatus) => void;
  send: (cmd: ClientCommand) => boolean;
  showToast: (message: string, extras?: ToastExtras) => void;
  dismissToast: () => void;
  selectFront: (id: string | null) => void;
  selectUnit: (id: string | null) => void;
  deploy: (frontId: string, model: UnitModel, name: string) => void;
  setDraft: (text: string, focus?: boolean) => void;
  openReport: (frontId: string) => void;
  closeReport: () => void;
  approve: (frontId: string) => void;
  openRepos: () => void;
  closeRepos: () => void;
}

let toastSeq = 0;
let sender: ((cmd: ClientCommand) => boolean) | null = null;
export const setSender = (fn: typeof sender) => (sender = fn);

export const useStore = create<ClientStore>((set, get) => ({
  war: emptyState(),
  connection: "connecting",
  synced: false,
  toast: null,
  selectedFrontId: null,
  selectedUnitId: null,
  deployingOn: null,
  draft: "",
  focusTick: 0,
  reportFor: null,
  approved: {},
  reposOpen: false,
  suggestions: null,

  apply: (ev) => {
    if (ev.type === "repo.suggestions") return set({ suggestions: ev.suggestions });
    const prev = get();
    const war = applyEvent(prev.war, ev);
    let { selectedFrontId, selectedUnitId, deployingOn } = prev;
    if (ev.type === "unit.upserted" && !prev.war.units[ev.unit.id] && ev.unit.frontId === deployingOn) {
      selectedUnitId = ev.unit.id;
      selectedFrontId = ev.unit.frontId;
      deployingOn = null;
    }
    if (selectedFrontId && !war.fronts[selectedFrontId]) selectedFrontId = null;
    if (selectedUnitId && !war.units[selectedUnitId]) selectedUnitId = null;
    const reportFor = prev.reportFor && war.fronts[prev.reportFor] ? prev.reportFor : null;
    set({ war, selectedFrontId, selectedUnitId, deployingOn, reportFor, ...(ev.type === "state.snapshot" ? { synced: true } : {}) });
    if (ev.type === "unit.tool") emitTool(ev.unitId);
    const note = shippingNote(prev.war, ev);
    if (note) get().showToast(note.message, note);
    if (ev.type === "error") {
      if (ev.command === "unit.create") set({ deployingOn: null });
      get().showToast(ev.message);
    }
  },
  setConnection: (connection) => set(connection === "open" ? { connection } : { connection, synced: false }),
  send: (cmd) => {
    const ok = sender?.(cmd) ?? false;
    if (!ok) get().showToast("Not connected to the daemon");
    return ok;
  },
  showToast: (message, extras = {}) => set({ toast: { id: ++toastSeq, message, ...extras } }),
  dismissToast: () => set({ toast: null }),
  selectFront: (selectedFrontId) => set({ selectedFrontId, selectedUnitId: null }),
  selectUnit: (id) => {
    const unit = id ? get().war.units[id] : undefined;
    set(unit ? { selectedUnitId: unit.id, selectedFrontId: unit.frontId } : { selectedUnitId: null });
  },
  deploy: (frontId, model, name) => {
    if (get().send({ type: "unit.create", frontId, model, name })) set({ deployingOn: frontId });
  },
  setDraft: (draft, focus = false) => set((s) => ({ draft, focusTick: focus ? s.focusTick + 1 : s.focusTick })),
  openReport: (frontId) => {
    get().send({ type: "diff.request", frontId });
    set({ reportFor: frontId });
  },
  closeReport: () => set({ reportFor: null }),
  openRepos: () => {
    set({ reposOpen: true, suggestions: null });
    get().send({ type: "repo.suggest" });
  },
  closeRepos: () => set({ reposOpen: false }),
  approve: (frontId) =>
    set((s) => ({ approved: { ...s.approved, [frontId]: diffSignature(s.war, frontId) }, reportFor: null })),
}));

/** Toast for shipping milestones the user just caused or should hear about. Each points at its front. */
function shippingNote(before: WarState, ev: ServerEvent): ({ message: string } & ToastExtras) | null {
  const front = "frontId" in ev && typeof ev.frontId === "string" ? before.fronts[ev.frontId] : undefined;
  if (!front) return null;
  const name = frontTitle(before, front);
  const prLink = (href: string | undefined) => (href ? { link: { label: "View PR ↗", href } } : {});
  switch (ev.type) {
    case "tests.result": {
      const t = ev.tests;
      if (t.status === "running" || t.status === "unknown" || front.tests.status !== "running") return null;
      const counts = `${t.passed} passed, ${t.failed} failed.`;
      return { message: t.status === "failed" ? `${counts} Bunker on ${name}` : `${counts} Road clear on ${name}`, frontId: front.id };
    }
    case "pr.opened":
      if (front.pr?.number === ev.number && front.pr.state === "open") return null;
      return { message: `PR #${ev.number} is open on ${name}. Merge it to take the objective.`, frontId: front.id, ...prLink(ev.url) };
    case "pr.merged":
      if (front.pr?.state === "merged") return null;
      return { message: `Front won · ${name} merged`, frontId: front.id, ...prLink(front.pr?.url) };
    default:
      return null;
  }
}

/** Cheap identity for a front's current diff. */
export const diffSignature = (war: WarState, frontId: string) =>
  (war.diffs[frontId] ?? []).map((f) => `${f.path}:${f.added}:${f.removed}`).join("|");

export const unitsOnFront = (war: WarState, frontId: string) =>
  Object.values(war.units)
    .filter((u) => u.frontId === frontId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const pendingFor = (war: WarState, unitId: string) =>
  Object.values(war.permissions)
    .filter((p) => p.unitId === unitId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const sortedRepos = (war: WarState) =>
  Object.values(war.repos).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));

/** Fronts in a stable display order: grouped by repo, then by branch. */
export const sortedFronts = (war: WarState): Front[] => {
  const order = new Map(sortedRepos(war).map((r, i) => [r.id, i]));
  return Object.values(war.fronts).sort(
    (a, b) =>
      (order.get(a.repoId) ?? 0) - (order.get(b.repoId) ?? 0) ||
      (a.branch ?? "~").localeCompare(b.branch ?? "~") ||
      a.path.localeCompare(b.path),
  );
};

/** "branch", or "repo · branch" once more than one repo is monitored. */
export const frontTitle = (war: WarState, f: Front) => {
  const branch = f.branch ?? `detached @ ${f.head.slice(0, 7)}`;
  const repo = war.repos[f.repoId];
  return Object.keys(war.repos).length > 1 && repo ? `${repo.name} · ${branch}` : branch;
};
