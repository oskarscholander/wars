import * as THREE from "three";
import { hashString, mulberry32 } from "./seed.ts";
import { COLORS } from "./look.ts";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export interface Circle {
  x: number;
  z: number;
  r: number;
}

/** Island footprint in local units. Big enough for the largest shapes plus their beach shelf. */
export const TERRAIN = { width: 32, depth: 40, segX: 96, segZ: 120 } as const;
const LIMIT_X = TERRAIN.width / 2 - 1.6;
const LIMIT_Z = TERRAIN.depth / 2 - 1.6;

export type TerrainStyle = "flat" | "rolling" | "peak";

/** A bump (peninsula) or dent (bay) on the coastline, at an angle around the island. */
interface CoastFeature {
  angle: number;
  width: number;
  amp: number;
}

const angDiff = (a: number, b: number) => {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};

/**
 * Everything about one island's shape, derived from its seed: size, aspect
 * and bend, coastline lobes, bays, peninsulas and islets, terrain style, and a
 * road that winds from HQ to the flag while staying on land. Pure and
 * deterministic, so each branch gets the same island on every reload.
 */
export class IslandShape {
  readonly curve: THREE.CatmullRomCurve3;
  readonly style: TerrainStyle;
  /** Share of pines among trees (the rest are round). */
  readonly pineShare: number;
  /** Tree density multiplier. */
  readonly treeDensity: number;
  /** Radius of a circle around the origin that holds all land (for layout and camera). */
  readonly extent: number;

  readonly #samples: THREE.Vector3[];
  readonly #R: number;
  readonly #aspect: number;
  readonly #bend: number;
  readonly #lobes: { k: number; amp: number; phase: number }[];
  readonly #features: CoastFeature[];
  readonly #islets: Circle[];
  readonly #scale: number;
  readonly #terrain: { hill: number; fx: number; fz: number; p: number[]; peak: Circle & { h: number } | null };

  constructor(seed: string) {
    const rnd = mulberry32(hashString(seed + ":shape"));
    const pick = <T,>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)]!;
    this.#R = 7.2 + rnd() * 2.6;
    this.#aspect = 1.05 + rnd() * 0.6;
    this.#bend = (rnd() - 0.5) * 3.6; // crescent / banana
    this.#lobes = [
      { k: 2 + Math.floor(rnd() * 3), amp: 0.5 + rnd() * 1.3, phase: rnd() * 6.28 },
      { k: 5 + Math.floor(rnd() * 3), amp: 0.25 + rnd() * 0.7, phase: rnd() * 6.28 },
      { k: 8 + Math.floor(rnd() * 4), amp: 0.15 + rnd() * 0.35, phase: rnd() * 6.28 },
    ];
    this.#features = [];
    const bays = Math.floor(rnd() * 3);
    for (let i = 0; i < bays; i++) this.#features.push({ angle: rnd() * 6.28, width: 0.22 + rnd() * 0.3, amp: -(1.6 + rnd() * 1.8) });
    const capes = Math.floor(rnd() * 3);
    for (let i = 0; i < capes; i++) this.#features.push({ angle: rnd() * 6.28, width: 0.14 + rnd() * 0.22, amp: 1.4 + rnd() * 2.2 });

    this.style = pick(["flat", "rolling", "rolling", "peak"] as const);
    this.pineShare = 0.2 + rnd() * 0.65;
    this.treeDensity = 0.65 + rnd() * 0.75;
    const p = Array.from({ length: 6 }, () => rnd() * 6.28);
    const hill = this.style === "flat" ? 0.25 + rnd() * 0.35 : this.style === "rolling" ? 0.9 + rnd() * 1.1 : 0.5 + rnd() * 0.6;
    this.#terrain = { hill, fx: 0.3 + rnd() * 0.3, fz: 0.28 + rnd() * 0.25, p, peak: null };

    // Fit inside the terrain square: shrink every radial term together if needed.
    let maxX = 0;
    let maxZ = 0;
    this.#scale = 1;
    for (let i = 0; i < 144; i++) {
      const pt = this.#coastPoint((i / 144) * Math.PI * 2);
      maxX = Math.max(maxX, Math.abs(pt.x));
      maxZ = Math.max(maxZ, Math.abs(pt.z));
    }
    this.#scale = Math.min(1, LIMIT_X / maxX, LIMIT_Z / maxZ);

    // Islets just off the coast on some islands.
    this.#islets = [];
    const islets = rnd() < 0.45 ? 1 + Math.floor(rnd() * 2) : 0;
    for (let i = 0; i < islets; i++) {
      const a = rnd() * 6.28;
      const r = 1.3 + rnd() * 1.1;
      const c = this.#coastPoint(a);
      const out = 2.4 + r + rnd() * 1.5;
      const len = Math.hypot(c.x, c.z) || 1;
      const islet = { x: c.x + (c.x / len) * out, z: c.z + (c.z / len) * out, r };
      if (Math.abs(islet.x) + r < LIMIT_X + 0.8 && Math.abs(islet.z) + r < LIMIT_Z + 0.8) this.#islets.push(islet);
    }

    let extent = 0;
    for (let i = 0; i < 144; i++) {
      const pt = this.#coastPoint((i / 144) * Math.PI * 2);
      extent = Math.max(extent, Math.hypot(pt.x, pt.z));
    }
    for (const i of this.#islets) extent = Math.max(extent, Math.hypot(i.x, i.z) + i.r);
    this.extent = extent + 0.6;

    // Road: runs along the island's land centreline from HQ (south, +z) to the flag (north, -z),
    // winding only as far as the land on either side allows.
    const amp = 1.2 + rnd() * 1.8;
    const freq = 0.9 + rnd() * 0.8;
    const ph = rnd() * 6.28;
    // The curve can bulge between control points: damp the winding until every point clears the coast.
    let curve = this.#road(amp, freq, ph);
    for (let damp = 0.7; damp > 0.05; damp *= 0.6) {
      if (curve.getSpacedPoints(80).every((q) => this.#mainEdge(q.x, q.z) > 0.93)) break;
      curve = this.#road(amp * damp, freq, ph);
    }
    this.curve = curve;
    this.#samples = this.curve.getSpacedPoints(160);

    // A mountain away from the road on "peak" islands.
    if (this.style === "peak") {
      for (let tries = 0; tries < 30; tries++) {
        const x = (rnd() - 0.5) * this.#R * 1.4;
        const z = (rnd() - 0.5) * this.#R * this.#aspect * 1.4;
        if (this.#mainEdge(x, z) > 0.95 && this.roadDist(x, z) > 3.5) {
          this.#terrain.peak = { x, z, r: 2.4 + rnd() * 1.6, h: 2.2 + rnd() * 1.8 };
          break;
        }
      }
    }
  }

  /** Coastline radius at angle `a`, in the island's unbent, unstretched frame. */
  #coastRadius(a: number): number {
    let r = this.#R;
    for (const l of this.#lobes) r += l.amp * Math.sin(l.k * a + l.phase);
    for (const f of this.#features) r += f.amp * Math.exp(-((angDiff(a, f.angle) / f.width) ** 2));
    return Math.max(3, r) * this.#scale;
  }

  /** Coast point at angle `a` in island coordinates (stretched and bent). */
  #coastPoint(a: number): { x: number; z: number } {
    const r = this.#coastRadius(a);
    const zz = r * Math.sin(a);
    const xx = r * Math.cos(a);
    return { x: xx + (this.#bend * zz * zz) / (this.#R * this.#scale), z: zz * this.#aspect };
  }

  #mainEdge(x: number, z: number): number {
    const zz = z / this.#aspect;
    const xx = x - (this.#bend * zz * zz) / (this.#R * this.#scale);
    const a = Math.atan2(zz, xx);
    const r = Math.hypot(xx, zz);
    const R = this.#coastRadius(a);
    return 1 - smooth(R - 3, R + 0.6, r);
  }

  /** Runs of solid land across x at depth `z`, at least `minWidth` wide. */
  #landRuns(z: number, minWidth = 2.4): { lo: number; hi: number }[] {
    const runs: { lo: number; hi: number }[] = [];
    let lo: number | null = null;
    for (let x = -LIMIT_X; x <= LIMIT_X; x += 0.25) {
      const inside = this.#mainEdge(x, z) > 0.97;
      if (inside && lo === null) lo = x;
      if (!inside && lo !== null) {
        runs.push({ lo, hi: x - 0.25 });
        lo = null;
      }
    }
    if (lo !== null) runs.push({ lo, hi: LIMIT_X });
    return runs.filter((r) => r.hi - r.lo >= minWidth);
  }

  /** The run at depth `z` that continues the one centred at `near` (it must overlap it). */
  #continueRun(z: number, prev: { lo: number; hi: number }): { lo: number; hi: number } | null {
    const overlapping = this.#landRuns(z).filter((r) => r.lo < prev.hi - 0.5 && r.hi > prev.lo + 0.5);
    if (!overlapping.length) return null;
    const mid = (prev.lo + prev.hi) / 2;
    return overlapping.reduce((a, b) => (Math.abs((a.lo + a.hi) / 2 - mid) <= Math.abs((b.lo + b.hi) / 2 - mid) ? a : b));
  }

  /**
   * A road along the land's centreline: start at the widest slice of land, walk
   * north and south slice by slice through connected land, and wind only as far
   * as the land on either side allows.
   */
  #road(amp: number, freq: number, phase: number): THREE.CatmullRomCurve3 {
    const STEP = 0.5;
    let seed: { z: number; lo: number; hi: number } | null = null;
    for (let z = -LIMIT_Z; z <= LIMIT_Z; z += STEP) {
      for (const r of this.#landRuns(z)) if (!seed || r.hi - r.lo > seed.hi - seed.lo) seed = { z, ...r };
    }
    if (!seed) seed = { z: 0, lo: -1, hi: 1 };
    const spans = [seed];
    for (let z = seed.z + STEP, prev = seed; z <= LIMIT_Z; z += STEP) {
      const r = this.#continueRun(z, prev);
      if (!r) break;
      spans.push((prev = { z, ...r }));
    }
    for (let z = seed.z - STEP, prev = seed; z >= -LIMIT_Z; z -= STEP) {
      const r = this.#continueRun(z, prev);
      if (!r) break;
      spans.unshift((prev = { z, ...r }));
    }
    // South (+z, HQ) first; leave a little room at both ends.
    spans.sort((a, b) => b.z - a.z);
    const usable = spans.length > 8 ? spans.slice(2, -2) : spans;
    const pts: THREE.Vector3[] = [];
    const every = 3; // a control point every 1.5 units keeps the curve on the land
    for (let i = 0; i < usable.length; i += every) {
      const sp = usable[i]!;
      const t = i / Math.max(1, usable.length - 1);
      const taper = Math.min(1, t * 4, (1 - t) * 4);
      const room = Math.max(0, (sp.hi - sp.lo) / 2 - 1.3);
      const wiggle = Math.sin(sp.z * freq * 0.35 + phase) * Math.min(amp * taper, room);
      pts.push(new THREE.Vector3((sp.lo + sp.hi) / 2 + wiggle, 0, sp.z));
    }
    const last = usable.at(-1)!;
    if (pts.at(-1)!.z !== last.z) pts.push(new THREE.Vector3((last.lo + last.hi) / 2, 0, last.z));
    if (pts.length < 2) pts.push(new THREE.Vector3(pts[0]!.x, 0, pts[0]!.z - 1));
    return new THREE.CatmullRomCurve3(pts);
  }

  /** Road curve parameter (0..1) of the road point nearest to (x, z). */
  nearestS(x: number, z: number): number {
    let m = Infinity;
    let best = 0;
    this.#samples.forEach((p, i) => {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < m) {
        m = d;
        best = i;
      }
    });
    return best / (this.#samples.length - 1);
  }

  roadDist(x: number, z: number): number {
    let m = Infinity;
    for (const p of this.#samples) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }

  /** 1 inland, 0 at sea, smooth across the coastline (main island or an islet). */
  edge(x: number, z: number): number {
    let e = this.#mainEdge(x, z);
    for (const i of this.#islets) e = Math.max(e, 1 - smooth(i.r * 0.35, i.r + 0.5, Math.hypot(x - i.x, z - i.z)));
    return e;
  }

  height(x: number, z: number, d = this.roadDist(x, z)): number {
    const { hill, fx, fz, p, peak } = this.#terrain;
    const e = this.edge(x, z);
    const base = 0.9 + 0.3 * Math.sin(0.4 * x + p[4]!) * Math.cos(0.33 * z + p[5]!) + 0.18 * Math.sin(0.7 * z + p[1]!);
    let hills =
      hill * (Math.max(0, Math.sin(fx * x + p[2]!) * Math.cos(fz * z + p[3]!) + 0.3) + 0.27 * Math.sin(1.3 * x - 0.9 * z + p[4]!));
    if (peak) hills += peak.h * Math.exp(-(((x - peak.x) ** 2 + (z - peak.z) ** 2) / (peak.r * peak.r)));
    hills *= smooth(1.8, 5.5, d);
    // Off the coast the floor drops below the seabed plane so the square terrain edge never shows.
    return (base + hills) * e - 2.7 * (1 - e);
  }

  /** Point on the road at curve parameter `s`, offset sideways by `lane`, on the ground. */
  roadPoint(s: number, lane = 0): { x: number; y: number; z: number; rot: number } {
    const t = clamp01(s);
    const pt = this.curve.getPointAt(t);
    const tg = this.curve.getTangentAt(t);
    const x = pt.x - tg.z * lane;
    const z = pt.z + tg.x * lane;
    return { x, y: this.height(x, z), z, rot: Math.atan2(-tg.x, -tg.z) };
  }
}

const shapeCache = new Map<string, IslandShape>();
/** Shared, cached shape per seed: layout and rendering use the same instance. */
export function islandShape(seed: string): IslandShape {
  let s = shapeCache.get(seed);
  if (!s) {
    s = new IslandShape(seed);
    shapeCache.set(seed, s);
  }
  return s;
}

/**
 * Vertex-coloured terrain mesh: wet sand, beach, road, grass shading, rock tops.
 * `growth` (0..1) lets grass creep over the road on old worktrees.
 */
export function buildTerrain(shape: IslandShape, ground: string, seed: string, growth = 0): THREE.BufferGeometry {
  const rnd = mulberry32(hashString(seed + ":terrain"));
  const geo = new THREE.PlaneGeometry(TERRAIN.width, TERRAIN.depth, TERRAIN.segX, TERRAIN.segZ);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position!;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const g1 = new THREE.Color(ground);
  const g2 = new THREE.Color(ground).multiplyScalar(0.7);
  const road1 = new THREE.Color("#b39b6b");
  const road2 = new THREE.Color("#9c8458");
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const d = shape.roadDist(x, z);
    const h = shape.height(x, z, d);
    pos.setY(i, h);
    if (h < 0.28) c.set(h < -0.15 ? COLORS.wetSand : COLORS.sand);
    else if (d < 1.3) {
      c.copy(road1).lerp(road2, rnd() * 0.4);
      // Overgrowth: edges first, then patches across the middle.
      const creep = growth * (0.35 + 0.65 * (d / 1.3)) + (rnd() - 0.5) * 0.3 * growth;
      c.lerp(g1, Math.max(0, Math.min(0.85, creep)));
    }
    else if (h > 2.4) c.set(COLORS.rock);
    else c.copy(g1).lerp(g2, clamp01((h - 0.3) / 2.2 + (rnd() - 0.5) * 0.18));
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });

/**
 * Trees, bushes and rocks, scattered with the island's seed. `growth` (0..1)
 * adds trees and makes them bigger, and grows bushes along the road. Trees are
 * placed in a fixed sequence, so an island gains trees as it ages instead of
 * reshuffling. Returned as one group to add to the scene.
 */
export function buildProps(shape: IslandShape, seed: string, growth = 0.4): THREE.Group & { userData: { obstacles: Circle[] } } {
  const obstacles: Circle[] = [];
  const rnd = mulberry32(hashString(seed + ":props"));
  const g = new THREE.Group();
  const trunkMat = mat("#5b4630");
  const pineMat = mat("#3e5f3a");
  const roundMat = mat("#557a3d");
  const rockMat = mat("#8a8778");
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.6, 8);

  const target = Math.round((12 + growth * 48) * shape.treeDensity);
  const grown = 0.8 + growth * 0.5;
  let placed = 0;
  for (let tries = 0; placed < target && tries < 900; tries++) {
    const x = (rnd() - 0.5) * (TERRAIN.width - 4);
    const z = (rnd() - 0.5) * (TERRAIN.depth - 4);
    if (shape.edge(x, z) < 0.85) continue;
    const d = shape.roadDist(x, z);
    if (d < 2.3) continue;
    // Keep the HQ clearing free.
    if (Math.hypot(x + 2.8, z - 9.2) < 2.5) continue;
    const h = shape.height(x, z, d);
    if (h < 0.5) continue;
    const tree = new THREE.Group();
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.y = 0.3;
    const round = rnd() > shape.pineShare;
    const crown = round
      ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + rnd() * 0.35, 0), roundMat)
      : new THREE.Mesh(new THREE.ConeGeometry(0.6 + rnd() * 0.3, 1.5 + rnd() * 0.9, 6), pineMat);
    crown.position.y = round ? 1.1 : 1.3;
    crown.rotation.y = rnd() * 6;
    tree.add(trunk, crown);
    const s = (0.75 + rnd() * 0.5) * grown;
    tree.scale.setScalar(s);
    tree.position.set(x, h - 0.05, z);
    obstacles.push({ x, z, r: 0.5 * s });
    g.add(tree);
    placed++;
  }
  // Bushes creeping in along the road on older islands.
  const brnd = mulberry32(hashString(seed + ":bushes"));
  const bushMat = mat("#4d6e38");
  const bushes = Math.round(growth * growth * 30);
  for (let placedB = 0, tries = 0; placedB < bushes && tries < 600; tries++) {
    const x = (brnd() - 0.5) * (TERRAIN.width - 4);
    const z = (brnd() - 0.5) * (TERRAIN.depth - 4);
    const d = shape.roadDist(x, z);
    if (d < 1.1 || d > 2.4 || shape.edge(x, z) < 0.8) continue;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + brnd() * 0.3, 0), bushMat);
    bush.position.set(x, shape.height(x, z, d) + 0.15, z);
    bush.scale.y = 0.7;
    g.add(bush);
    placedB++;
  }
  const rocks = shape.style === "peak" ? 22 : shape.style === "flat" ? 6 : 10;
  for (let k = 0; k < rocks; k++) {
    const x = (rnd() - 0.5) * (TERRAIN.width - 6);
    const z = (rnd() - 0.5) * (TERRAIN.depth - 6);
    if (shape.edge(x, z) < 0.6) continue;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rnd() * 0.3, 0), rockMat);
    r.position.set(x, shape.height(x, z) + 0.2, z);
    obstacles.push({ x, z, r: 0.45 });
    r.rotation.set(rnd(), rnd(), rnd());
    g.add(r);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  g.userData.obstacles = obstacles;
  return g as THREE.Group & { userData: { obstacles: Circle[] } };
}

/** Frees GPU memory for everything under `root`. */
export function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.geometry.dispose();
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    }
  });
}
