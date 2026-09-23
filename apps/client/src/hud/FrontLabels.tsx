import { useMemo } from "react";
import { frontAnchor, overlayRef } from "../overlay.ts";
import { sortedFronts, useStore } from "../store.ts";
import { frontLabel } from "../world/look.ts";

/** Branch name tags floating under each island. */
export function FrontLabels() {
  const war = useStore((s) => s.war);
  const selectedFrontId = useStore((s) => s.selectedFrontId);
  const selectFront = useStore((s) => s.selectFront);
  const fronts = useMemo(() => sortedFronts(war), [war]);

  return (
    <div className="layer">
      {fronts.map((f) => (
        <div key={f.id} className="anchor" ref={overlayRef(frontAnchor(f.id))}>
          <button
            className="flabel"
            aria-pressed={f.id === selectedFrontId}
            onClick={() => selectFront(f.id === selectedFrontId ? null : f.id)}
          >
            {frontLabel(f)}
          </button>
        </div>
      ))}
    </div>
  );
}
