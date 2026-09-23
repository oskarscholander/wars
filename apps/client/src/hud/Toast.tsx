import { useEffect, useRef, useState } from "react";
import { useStore } from "../store.ts";

const PLAIN_MS = 3500;
const ACTION_MS = 7000;

/** One toast at a time. Toasts about a front are clickable: they fly the camera there. Hover pauses them. */
export function Toast() {
  const toast = useStore((s) => s.toast);
  const { selectFront, dismissToast } = useStore.getState();
  const [visible, setVisible] = useState(false);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!toast) return setVisible(false);
    setVisible(true);
  }, [toast]);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!toast || !visible || hovered) return;
    timer.current = setTimeout(() => setVisible(false), toast.frontId ? ACTION_MS : PLAIN_MS);
    return () => clearTimeout(timer.current);
  }, [toast, visible, hovered]);

  const actionable = !!toast?.frontId;
  const go = () => {
    if (!toast?.frontId) return;
    selectFront(toast.frontId);
    dismissToast();
  };

  return (
    <div
      className={`toast${visible ? " show" : ""}${actionable ? " actionable" : ""}`}
      role="status"
      aria-live="polite"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {actionable ? (
        <>
          <button className="toast-main" onClick={go} title="Show this front">
            {toast!.message}
          </button>
          {toast!.link && (
            <a className="toast-link" href={toast!.link.href} target="_blank" rel="noopener noreferrer">
              {toast!.link.label}
            </a>
          )}
          <button className="toast-close" onClick={dismissToast} aria-label="Dismiss">
            ×
          </button>
        </>
      ) : (
        toast?.message
      )}
    </div>
  );
}
