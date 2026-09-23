import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { anchors, overlayEls } from "../overlay.ts";

const v = new Vector3();
const EDGE = 28;
const TOP_BAR = 72;

interface Rect {
  l: number;
  t: number;
  r: number;
  b: number;
}
const overlaps = (a: Rect, b: Rect) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;

/**
 * Projects every registered overlay element onto its world anchor. Elements
 * marked `data-pin` (the "Needs you" markers) never disappear: when their
 * anchor is off-screen they stick to the nearest screen edge. Elements marked
 * `data-declutter` (island labels) hide when they would overlap one already
 * shown this frame; `data-priority` ones are placed first.
 */
export function OverlayProjector() {
  useFrame(({ camera, size }) => {
    const panel = document.querySelector<HTMLElement>(".panel")?.offsetHeight ?? 140;
    const shown: Rect[] = [];
    const ordered = [...overlayEls].sort(
      ([, a], [, b]) => Number(b.dataset.priority !== undefined) - Number(a.dataset.priority !== undefined),
    );
    for (const [key, el] of ordered) {
      // bubble:/marker: elements follow their unit's anchor.
      const anchor = anchors.get(key) ?? anchors.get(key.replace(/^(bubble|marker):/, "unit:"));
      if (!anchor) {
        el.style.visibility = "hidden";
        continue;
      }
      v.copy(anchor).project(camera);
      const behind = v.z > 1;
      if (behind) v.set(-v.x, -v.y, v.z);
      let x = ((v.x + 1) / 2) * size.width;
      let y = ((1 - v.y) / 2) * size.height;
      const onScreen = !behind && Math.abs(v.x) < 1.05 && Math.abs(v.y) < 1.05;

      if (el.dataset.pin !== undefined) {
        const minY = TOP_BAR + EDGE;
        const maxY = size.height - panel - 8;
        const pinned = !onScreen || x < EDGE || x > size.width - EDGE || y < minY || y > maxY;
        if (behind && Math.abs(v.x) < 1 && Math.abs(v.y) < 1) y = maxY;
        const half = ((el.firstElementChild as HTMLElement | null)?.offsetWidth ?? 120) / 2 + 8;
        x = Math.min(size.width - half, Math.max(half, x));
        y = Math.min(maxY, Math.max(minY, y));
        el.classList.toggle("pinned", pinned);
        el.style.visibility = "visible";
      } else {
        let visible = onScreen;
        if (visible && el.dataset.declutter !== undefined) {
          const child = el.firstElementChild as HTMLElement | null;
          const w = (child?.offsetWidth ?? 100) / 2 + 3;
          const h = (child?.offsetHeight ?? 20) / 2 + 2;
          const rect = { l: x - w, r: x + w, t: y - h, b: y + h };
          visible = !shown.some((o) => overlaps(o, rect));
          if (visible) shown.push(rect);
        }
        el.style.visibility = visible ? "visible" : "hidden";
        if (!visible) continue;
      }
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}
