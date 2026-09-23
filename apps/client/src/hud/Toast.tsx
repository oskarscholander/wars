import { useEffect, useState } from "react";
import { useStore } from "../store.ts";

export function Toast() {
  const toast = useStore((s) => s.toast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!toast) return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  return (
    <div className={`toast${visible ? " show" : ""}`} role="status" aria-live="polite">
      {toast?.message}
    </div>
  );
}
