import { create } from "zustand";
import { emitTool } from "./events.ts";
import { applyEvent, emptyState, type ClientCommand, type Front, type LogEntry, type RepoSuggestion, type ServerEvent, type UnitModel, type WarState } from "@ww/shared";

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
  /**
   * What the camera was last asked to do. It only moves when `tick` changes:
   * picking a different island pans there (zooming in if needed, never out);
   * only the All fronts overview zooms out.
   */
  camera: { kind: "overview" | "front"; frontId: string | null; tick: number };
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
  /** Terminal transcripts fetched from the daemon, per unit. A cache: refetched on reconnect. */
  logs: Record<string, LogEntry[]>;
  /** Narrow screens: the selected unit's terminal as a sheet. */
  terminalOpen: boolean;
  /** Delete-worktree dialog. `dirty`/`locked` are git's refusals; `pending` while the daemon works. */
  deleting: { frontId: string; stage: "confirm" | "dirty" | "locked"; deleteBranch: boolean; pending: boolean; note?: string } | null;
  /** Latest `repo.suggestions` reply; null while loading. */
  suggestions: RepoSuggestion[] | null;

  apply: (ev: ServerEvent) => void;
  setConnection: (c: ConnectionStatus) => void;
  send: (cmd: ClientCommand) => boolean;
  showToast: (message: string, extras?: ToastExtras) => void;
  dismissToast: () => void;
  /** Select an island (null = All fronts overview). */
  selectFront: (id: string | null) => void;
  /** Deselect without moving the camera (e.g. clicking the water). */
  clearSelection: () => void;
  selectUnit: (id: string | null) => void;
  deploy: (frontId: string, model: UnitModel, name: string) => void;
  setDraft: (text: string, focus?: boolean) => void;
  openReport: (frontId: string) => void;
  closeReport: () => void;
  approve: (frontId: string) => void;
  openRepos: () => void;
  /** Fetches a unit's transcript unless it's already cached. */
  loadLog: (unitId: string) => void;
  setTerminalOpen: (open: boolean) => void;
  openDelete: (frontId: string) => void;
  closeDelete: () => void;
  setDeleteBranch: (on: boolean) => void;
  confirmDelete: (force: boolean) => void;
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
  camera: { kind: "overview", frontId: null, tick: 0 },
  deployingOn: null,
  draft: "",
  focusTick: 0,
  reportFor: null,
  approved: {},
  reposOpen: false,
  logs: {},
  terminalOpen: false,
  deleting: null,
  suggestions: null,

  apply: (ev) => {
    if (ev.type === "repo.suggestions") return set({ suggestions: ev.suggestions });
    if (ev.type === "unit.history") return set((st) => ({ logs: { ...st.logs, [ev.unitId]: mergeHistory(ev.entries, st.logs[ev.unitId]) } }));
    if (ev.type === "unit.entry") return set((st) => ({ logs: withEntry(st.logs, ev.entry) }));
    if (ev.type === "front.deleted") {
      const name = ev.branch ?? "worktree";
      set({ deleting: null });
      const branch = ev.branchDeleted ? " and its branch" : "";
      return get().showToast(ev.branchNote ? `Deleted ${name}. ${ev.branchNote}` : `Deleted ${name}${branch}`);
    }
    if (ev.type === "error" && ev.command === "front.delete") {
      const d = get().deleting;
      if (d && (!ev.frontId || ev.frontId === d.frontId)) {
        const stage = ev.code === "dirty" ? "dirty" : ev.code === "locked" ? "locked" : d.stage;
        return set({ deleting: { ...d, stage, pending: false, note: ev.message } });
      }
    }
    const prev = get();
    const war = applyEvent(prev.war, ev);
    // Transcript upkeep: streamed text grows its assistant line; a fresh snapshot means refetching.
    if (ev.type === "unit.text") set((st) => ({ logs: withDelta(st.logs, ev.unitId, ev.messageId, ev.delta) }));
    if (ev.type === "state.snapshot") set({ logs: {} });
    let { selectedFrontId, selectedUnitId, deployingOn } = prev;
    if (ev.type === "unit.upserted" && !prev.war.units[ev.unit.id] && ev.unit.frontId === deployingOn) {
      selectedUnitId = ev.unit.id;
      selectedFrontId = ev.unit.frontId;
      deployingOn = null;
    }
    if (selectedFrontId && !war.fronts[selectedFrontId]) selectedFrontId = null;
    if (selectedUnitId && !war.units[selectedUnitId]) selectedUnitId = null;
    const reportFor = prev.reportFor && war.fronts[prev.reportFor] ? prev.reportFor : null;
    const deleting = prev.deleting && war.fronts[prev.deleting.frontId] ? prev.deleting : prev.deleting?.pending ? prev.deleting : null;
    set({ war, selectedFrontId, selectedUnitId, deployingOn, reportFor, deleting, ...(ev.type === "state.snapshot" ? { synced: true } : {}) });
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
  selectFront: (id) => {
    const { selectedFrontId, camera } = get();
    if (id !== null && id === selectedFrontId) return set({ selectedUnitId: null }); // already there: don't move
    set({
      selectedFrontId: id,
      selectedUnitId: null,
      camera: { kind: id ? "front" : "overview", frontId: id, tick: camera.tick + 1 },
    });
  },
  clearSelection: () => set({ selectedFrontId: null, selectedUnitId: null }),
  selectUnit: (id) => {
    const { war, selectedFrontId, camera } = get();
    const unit = id ? war.units[id] : undefined;
    if (!unit) return set({ selectedUnitId: null });
    set({
      selectedUnitId: unit.id,
      selectedFrontId: unit.frontId,
      ...(unit.frontId !== selectedFrontId ? { camera: { kind: "front" as const, frontId: unit.frontId, tick: camera.tick + 1 } } : {}),
    });
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
  loadLog: (unitId) => {
    if (get().logs[unitId]) return;
    if (get().send({ type: "unit.history", unitId })) set((st) => ({ logs: { ...st.logs, [unitId]: st.logs[unitId] ?? [] } }));
  },
  setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
  openDelete: (frontId) => set({ deleting: { frontId, stage: "confirm", deleteBranch: false, pending: false } }),
  closeDelete: () => set({ deleting: null }),
  setDeleteBranch: (on) => set((s) => (s.deleting ? { deleting: { ...s.deleting, deleteBranch: on } } : {})),
  confirmDelete: (force) => {
    const d = get().deleting;
    if (!d || d.pending) return;
    if (get().send({ type: "front.delete", frontId: d.frontId, force, deleteBranch: d.deleteBranch })) {
      set({ deleting: { ...d, pending: true } });
    }
  },
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

/** Adds a live line. An assistant line may already exist locally if its first delta arrived first. */
function withEntry(logs: Record<string, LogEntry[]>, entry: LogEntry): Record<string, LogEntry[]> {
  const list = logs[entry.unitId];
  if (!list) return logs; // not open in a terminal; history will include it
  const i = entry.messageId ? list.findIndex((e) => e.messageId === entry.messageId) : -1;
  if (i >= 0) {
    const next = [...list];
    next[i] = { ...entry, text: list[i]!.text || entry.text };
    return { ...logs, [entry.unitId]: next };
  }
  if (list.some((e) => e.id === entry.id)) return logs;
  return { ...logs, [entry.unitId]: [...list, entry] };
}

function withDelta(logs: Record<string, LogEntry[]>, unitId: string, messageId: string, delta: string): Record<string, LogEntry[]> {
  const list = logs[unitId];
  if (!list || messageId.startsWith("error-")) return logs;
  const i = list.findIndex((e) => e.messageId === messageId);
  const next = [...list];
  if (i >= 0) next[i] = { ...next[i]!, text: next[i]!.text + delta };
  else next.push({ id: -Date.now(), unitId, at: Date.now(), kind: "assistant", text: delta, messageId });
  return { ...logs, [unitId]: next };
}

/** History is authoritative; keep live lines that arrived after it was read. */
function mergeHistory(history: LogEntry[], live: LogEntry[] | undefined): LogEntry[] {
  const last = history.at(-1)?.id ?? 0;
  const newer = (live ?? []).filter((e) => e.id > last && !history.some((h) => h.messageId && h.messageId === e.messageId));
  return [...history, ...newer];
}
