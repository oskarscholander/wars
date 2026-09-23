import { create } from "zustand";
import { applyEvent, emptyState, type ClientCommand, type ServerEvent, type UnitModel, type WarState } from "@ww/shared";

export type ConnectionStatus = "connecting" | "open" | "offline";

interface Toast {
  id: number;
  message: string;
}

interface ClientStore {
  /** Mirror of daemon state: only ever changed by daemon events. */
  war: WarState;
  connection: ConnectionStatus;
  toast: Toast | null;
  /** UI-only selection; not part of daemon state. */
  selectedFrontId: string | null;
  selectedUnitId: string | null;
  /** Front we just asked to deploy on, so the new unit gets selected when it arrives. */
  deployingOn: string | null;

  apply: (ev: ServerEvent) => void;
  setConnection: (c: ConnectionStatus) => void;
  send: (cmd: ClientCommand) => boolean;
  showToast: (message: string) => void;
  selectFront: (id: string | null) => void;
  selectUnit: (id: string | null) => void;
  deploy: (frontId: string, model: UnitModel, name: string) => void;
}

let toastSeq = 0;
let sender: ((cmd: ClientCommand) => boolean) | null = null;
export const setSender = (fn: typeof sender) => (sender = fn);

export const useStore = create<ClientStore>((set, get) => ({
  war: emptyState(),
  connection: "connecting",
  toast: null,
  selectedFrontId: null,
  selectedUnitId: null,
  deployingOn: null,

  apply: (ev) => {
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
    set({ war, selectedFrontId, selectedUnitId, deployingOn });
    if (ev.type === "error") {
      if (ev.command === "unit.create") set({ deployingOn: null });
      get().showToast(ev.message);
    }
  },
  setConnection: (connection) => set({ connection }),
  send: (cmd) => {
    const ok = sender?.(cmd) ?? false;
    if (!ok) get().showToast("Not connected to the daemon");
    return ok;
  },
  showToast: (message) => set({ toast: { id: ++toastSeq, message } }),
  selectFront: (selectedFrontId) => set({ selectedFrontId, selectedUnitId: null }),
  selectUnit: (id) => {
    const unit = id ? get().war.units[id] : undefined;
    set(unit ? { selectedUnitId: unit.id, selectedFrontId: unit.frontId } : { selectedUnitId: null });
  },
  deploy: (frontId, model, name) => {
    if (get().send({ type: "unit.create", frontId, model, name })) set({ deployingOn: frontId });
  },
}));

export const unitsOnFront = (war: WarState, frontId: string) =>
  Object.values(war.units)
    .filter((u) => u.frontId === frontId)
    .sort((a, b) => a.createdAt - b.createdAt);

export const pendingFor = (war: WarState, unitId: string) =>
  Object.values(war.permissions)
    .filter((p) => p.unitId === unitId)
    .sort((a, b) => a.createdAt - b.createdAt);

/** Fronts in a stable display order (by branch, then path). */
export const sortedFronts = (war: WarState) =>
  Object.values(war.fronts).sort(
    (a, b) => (a.branch ?? "~").localeCompare(b.branch ?? "~") || a.path.localeCompare(b.path),
  );
