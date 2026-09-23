import { hashString, mulberry32 } from "./seed.ts";

/** Where one island sits: centre in world space and its yaw. */
export interface Placement {
  x: number;
  z: number;
  yaw: number;
}

/** Radius of one island's footprint (coast plus beach shelf), in world units. */
export const ISLAND_RADIUS = 15;
/** Closest two island centres may be; each pair gets a little extra seeded slack. */
const MIN_GAP = 27;
/** Closest two islands of different repos may be, so archipelagos read as separate. */
const REPO_GAP = 36;

export interface IslandGroup {
  key: string;
  /** Island ids in a stable order (oldest first), so new worktrees never move old ones. */
  ids: string[];
}

type Point = { x: number; z: number };

/**
 * First spot on growing rings around the origin, starting at a seeded angle,
 * that `fits`. Deterministic for the same inputs and seed.
 */
function findSpot(fits: (p: Point, extra: number) => boolean, seed: string, slack: number, first: boolean): Point {
  if (first) return { x: 0, z: 0 };
  const rnd = mulberry32(hashString(seed));
  const start = rnd() * Math.PI * 2;
  const extra = rnd() * slack;
  for (let ring = 10; ring < 5000; ring += 3) {
    const steps = Math.max(8, Math.round((2 * Math.PI * ring) / 6));
    for (let k = 0; k < steps; k++) {
      const a = start + (k / steps) * Math.PI * 2;
      const p = { x: Math.cos(a) * ring + (rnd() - 0.5) * 3, z: Math.sin(a) * ring + (rnd() - 0.5) * 3 };
      if (fits(p, extra)) return p;
    }
  }
  return { x: 0, z: 0 };
}

/**
 * Scatters islands into one loose archipelago per repo. Positions and yaw are
 * seeded by ids, so the map is the same on every reload; landscape screens
 * spread it wider, portrait screens taller.
 */
export function scatterIslands(groups: IslandGroup[], portrait: boolean): Map<string, Placement> {
  const out = new Map<string, Placement>();
  const clusters: { key: string; members: (Point & { id: string; yaw: number })[] }[] = [];

  for (const g of groups) {
    if (!g.ids.length) continue;
    const placed: (Point & { id: string; yaw: number })[] = [];
    for (const id of g.ids) {
      const fits = (p: Point, extra: number) => placed.every((q) => Math.hypot(p.x - q.x, p.z - q.z) >= MIN_GAP + extra);
      const spot = findSpot(fits, `island:${id}`, 3, !placed.length);
      const yaw = (mulberry32(hashString(`yaw:${id}`))() - 0.5) * 1.1;
      placed.push({ ...spot, id, yaw });
    }
    // Recentre the cluster on its own centroid so packing uses a tight radius.
    const cx = placed.reduce((s, p) => s + p.x, 0) / placed.length;
    const cz = placed.reduce((s, p) => s + p.z, 0) / placed.length;
    clusters.push({ key: g.key, members: placed.map((p) => ({ ...p, x: p.x - cx, z: p.z - cz })) });
  }

  // Pack repos by real island distances, not bounding circles, so archipelagos sit close but apart.
  const taken: Point[] = [];
  for (const c of clusters) {
    const fits = (at: Point, extra: number) =>
      c.members.every((m) => taken.every((q) => Math.hypot(at.x + m.x - q.x, at.z + m.z - q.z) >= REPO_GAP + extra));
    const at = findSpot(fits, `cluster:${c.key}`, 6, !taken.length);
    for (const m of c.members) taken.push({ x: at.x + m.x, z: at.z + m.z });
    for (const m of c.members) {
      const x = at.x + m.x;
      const z = at.z + m.z;
      // Stretch only: distances never shrink, so islands never overlap.
      out.set(m.id, { x: portrait ? x : x * 1.1, z: portrait ? z * 1.1 : z, yaw: m.yaw });
    }
  }
  return out;
}

/** Local island coordinates to world space. Matches three.js rotation about Y. */
export function toWorld(p: Placement, x: number, z: number): Point {
  const c = Math.cos(p.yaw);
  const s = Math.sin(p.yaw);
  return { x: p.x + c * x + s * z, z: p.z - s * x + c * z };
}
