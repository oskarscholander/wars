import type { Front, Unit } from "./types.ts";

/** Road position of the bunker, as a progress value. Units stop just short of it. */
export const BUNKER_AT = 0.69;
const BEFORE_BUNKER = BUNKER_AT - 0.04;

/**
 * v1 heuristic for how far along the road a unit is (0 = HQ, 1 = flag).
 * Kept in one place so it is easy to tune.
 */
export function unitProgress(unit: Pick<Unit, "filesChanged" | "turns">, front: Pick<Front, "tests" | "pr">): number {
  if (front.pr && front.pr.state !== "closed") return 1;
  const raw = Math.min(0.95, unit.filesChanged * 0.08 + unit.turns * 0.03);
  return front.tests.status === "failed" ? Math.min(raw, BEFORE_BUNKER) : raw;
}
