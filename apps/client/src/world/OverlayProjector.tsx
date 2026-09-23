import { useFrame } from "@react-three/fiber";
import { Vector3 } from "three";
import { anchors, overlayEls } from "../overlay.ts";

const v = new Vector3();

/** Projects every registered overlay element onto its world anchor. */
export function OverlayProjector() {
  useFrame(({ camera, size }) => {
    for (const [key, el] of overlayEls) {
      const anchor = anchors.get(key);
      if (!anchor) {
        el.style.visibility = "hidden";
        continue;
      }
      v.copy(anchor).project(camera);
      const onScreen = v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2;
      el.style.visibility = onScreen ? "visible" : "hidden";
      if (!onScreen) continue;
      const x = ((v.x + 1) / 2) * size.width;
      const y = ((1 - v.y) / 2) * size.height;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }
  });
  return null;
}
