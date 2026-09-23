import { create } from "zustand";
import { applyEvent, emptyState, type ClientCommand, type ServerEvent, type WarState } from "@ww/shared";

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

  apply: (ev: ServerEvent) => void;
  setConnection: (c: ConnectionStatus) => void;
  send: (cmd: ClientCommand) => boolean;
  showToast: (message: string) => void;
  selectFront: (id: string | null) => void;
}

let toastSeq = 0;
let sender: ((cmd: ClientCommand) => boolean) | null = null;
export const setSender = (fn: typeof sender) => (sender = fn);

export const useStore = create<ClientStore>((set, get) => ({
  war: emptyState(),
  connection: "connecting",
  toast: null,
  selectedFrontId: null,

  apply: (ev) => {
    const war = applyEvent(get().war, ev);
    const selected = get().selectedFrontId;
    set({ war, selectedFrontId: selected && war.fronts[selected] ? selected : null });
    if (ev.type === "error") get().showToast(ev.message);
  },
  setConnection: (connection) => set({ connection }),
  send: (cmd) => {
    const ok = sender?.(cmd) ?? false;
    if (!ok) get().showToast("Not connected to the daemon");
    return ok;
  },
  showToast: (message) => set({ toast: { id: ++toastSeq, message } }),
  selectFront: (selectedFrontId) => set({ selectedFrontId }),
}));

/** Fronts in a stable display order (by branch, then path). */
export const sortedFronts = (war: WarState) =>
  Object.values(war.fronts).sort(
    (a, b) => (a.branch ?? "~").localeCompare(b.branch ?? "~") || a.path.localeCompare(b.path),
  );
