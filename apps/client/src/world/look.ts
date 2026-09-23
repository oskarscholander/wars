import type { Front } from "@ww/shared";
import { hashString, mulberry32 } from "./seed.ts";

export const COLORS = {
  sky: "#a9c3c9",
  water: "#3d8088",
  seabed: "#26474d",
  sand: "#d9c690",
  wetSand: "#9d9068",
  rock: "#8f8b7b",
  tent: "#7d7456",
  pole: "#cfc7b0",
  flagEnemy: "#9c3b2e",
  brass: "#d4a93a",
} as const;

const GROUNDS = ["#6f8a4c", "#86884a", "#5c7d5a", "#728f55", "#7b8246"];
const TEAMS = ["#3f6fb5", "#b0791b", "#8b4f9e", "#2f8a7a", "#b5533f", "#5a6fb0"];

export interface FrontLook {
  ground: string;
  team: string;
  /** Six phase offsets that shape the coastline and terrain. */
  phases: number[];
}

/** Everything visual about an island derives from its branch (or path when detached). */
export function frontLook(front: Pick<Front, "branch" | "path">): FrontLook {
  const seed = hashString(front.branch ?? front.path);
  const rnd = mulberry32(seed);
  return {
    ground: GROUNDS[seed % GROUNDS.length]!,
    team: TEAMS[(seed >>> 8) % TEAMS.length]!,
    phases: Array.from({ length: 6 }, () => rnd() * Math.PI * 2),
  };
}

export const frontLabel = (front: Pick<Front, "branch" | "head">) => front.branch ?? `detached @ ${front.head.slice(0, 7)}`;
