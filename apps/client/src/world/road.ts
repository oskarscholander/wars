import * as THREE from "three";

/** Height of the placeholder island's flat top. Terrain replaces this in milestone 5. */
export const GROUND_Y = 0.75;

/** Winding road from HQ (s = 0, south) to the flag (s = 1, north), seeded like the coastline. */
export function roadCurve(phases: number[]): THREE.CatmullRomCurve3 {
  const pts: THREE.Vector3[] = [];
  for (let k = 0; k <= 6; k++) {
    const z = 9.5 - (k * 19) / 6;
    const amp = k === 0 || k === 6 ? 0.4 : 2.3;
    pts.push(new THREE.Vector3(Math.sin(k * 1.2 + phases[0]!) * amp, 0, z));
  }
  return new THREE.CatmullRomCurve3(pts);
}

export interface RoadPoint {
  x: number;
  z: number;
  /** Yaw that faces the direction of travel (toward the flag). */
  rot: number;
}

export function roadPoint(curve: THREE.CatmullRomCurve3, s: number, lane = 0): RoadPoint {
  const t = Math.min(1, Math.max(0, s));
  const p = curve.getPointAt(t);
  const tg = curve.getTangentAt(t);
  return { x: p.x - tg.z * lane, z: p.z + tg.x * lane, rot: Math.atan2(-tg.x, -tg.z) };
}

/** Progress (0..1) to curve parameter: units start past HQ and stop before the flag. */
export const roadS = (progress: number) => 0.05 + progress * 0.86;

/** Side-by-side lanes so several units on one road don't overlap. */
export const laneFor = (index: number, count: number) =>
  Math.max(-2.2, Math.min(2.2, (index - (count - 1) / 2) * 1.7));
