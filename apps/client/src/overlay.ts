import type { Vector3 } from "three";

/**
 * Bridge between the 3D world and HTML overlays (labels, bubbles, markers).
 * The world publishes anchor positions; the HUD registers elements under the
 * same key; `OverlayProjector` moves each element to its anchor every frame
 * without going through React.
 */
export const anchors = new Map<string, Vector3>();
export const overlayEls = new Map<string, HTMLElement>();

export const frontAnchor = (frontId: string) => `front:${frontId}`;
/** Point just above a unit's head. Bubbles and markers share it. */
export const unitAnchor = (unitId: string) => `unit:${unitId}`;
export const bubbleKey = (unitId: string) => `bubble:${unitId}`;
export const markerKey = (unitId: string) => `marker:${unitId}`;

/** Ref callback that registers an overlay element under `key`. */
export const overlayRef = (key: string) => (el: HTMLElement | null) => {
  if (el) {
    el.style.visibility = "hidden";
    overlayEls.set(key, el);
  } else {
    overlayEls.delete(key);
  }
};
