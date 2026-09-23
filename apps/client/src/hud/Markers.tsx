import { markerKey, overlayRef } from "../overlay.ts";
import { useStore } from "../store.ts";

/** "Needs you" over every unit waiting on a permission, except the one whose bubble is open. */
export function Markers() {
  const war = useStore((s) => s.war);
  const selectedUnitId = useStore((s) => s.selectedUnitId);
  const selectUnit = useStore((s) => s.selectUnit);
  const waiting = [...new Set(Object.values(war.permissions).map((p) => p.unitId))].filter(
    (id) => id !== selectedUnitId && war.units[id],
  );

  return (
    <div className="layer">
      {waiting.map((id) => (
        <div key={id} className="anchor" data-pin ref={overlayRef(markerKey(id))}>
          <button className="mark" onClick={() => selectUnit(id)}>
            {war.units[id]!.name} needs you
          </button>
        </div>
      ))}
    </div>
  );
}
