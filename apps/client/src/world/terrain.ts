import * as THREE from "three";
import { hashString, mulberry32 } from "./seed.ts";
import { COLORS } from "./look.ts";

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Island footprint in local units. */
export const TERRAIN = { width: 26, depth: 34, segX: 78, segZ: 102 } as const;

/**
 * Everything about one island's shape, derived from its seed: the road curve,
 * the coastline, and the height field. Pure and deterministic, so each branch
 * gets the same island on every reload.
 */
export class IslandShape {
  readonly phases: number[];
  readonly curve: THREE.CatmullRomCurve3;
  readonly #samples: THREE.Vector3[];

  constructor(phases: number[]) {
    this.phases = phases;
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 6; k++) {
      const z = 9.5 - (k * 19) / 6;
      const amp = k === 0 || k === 6 ? 0.4 : 2.3;
      pts.push(new THREE.Vector3(Math.sin(k * 1.2 + phases[0]!) * amp, 0, z));
    }
    this.curve = new THREE.CatmullRomCurve3(pts);
    this.#samples = this.curve.getSpacedPoints(160);
  }

  roadDist(x: number, z: number): number {
    let m = Infinity;
    for (const p of this.#samples) {
      const d = (p.x - x) ** 2 + (p.z - z) ** 2;
      if (d < m) m = d;
    }
    return Math.sqrt(m);
  }

  /** 1 inland, 0 at sea, smooth across the irregular coastline. */
  edge(x: number, z: number): number {
    const p = this.phases;
    const zz = z / 1.4;
    const a = Math.atan2(zz, x);
    const r = Math.hypot(x, zz);
    const R = 8.6 + 1.1 * Math.sin(3 * a + p[1]!) + 0.7 * Math.sin(5 * a + p[2]!) + 0.4 * Math.sin(8 * a + p[3]!);
    return 1 - smooth(R - 3, R + 0.6, r);
  }

  height(x: number, z: number, d = this.roadDist(x, z)): number {
    const p = this.phases;
    const e = this.edge(x, z);
    const base = 0.9 + 0.3 * Math.sin(0.4 * x + p[4]!) * Math.cos(0.33 * z + p[5]!) + 0.18 * Math.sin(0.7 * z + p[1]!);
    const hills =
      (1.3 * Math.max(0, Math.sin(0.45 * x + p[2]!) * Math.cos(0.38 * z + p[3]!) + 0.3) +
        0.35 * Math.sin(1.3 * x - 0.9 * z + p[4]!)) *
      smooth(1.8, 5.5, d);
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
export function buildProps(shape: IslandShape, seed: string, growth = 0.4): THREE.Group {
  const rnd = mulberry32(hashString(seed + ":props"));
  const g = new THREE.Group();
  const trunkMat = mat("#5b4630");
  const pineMat = mat("#3e5f3a");
  const roundMat = mat("#557a3d");
  const rockMat = mat("#8a8778");
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.16, 0.6, 8);

  const target = Math.round(12 + growth * 48);
  const grown = 0.8 + growth * 0.5;
  let placed = 0;
  for (let tries = 0; placed < target && tries < 900; tries++) {
    const x = (rnd() - 0.5) * 24;
    const z = (rnd() - 0.5) * 32;
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
    const round = rnd() < 0.4;
    const crown = round
      ? new THREE.Mesh(new THREE.IcosahedronGeometry(0.7 + rnd() * 0.35, 0), roundMat)
      : new THREE.Mesh(new THREE.ConeGeometry(0.6 + rnd() * 0.3, 1.5 + rnd() * 0.9, 6), pineMat);
    crown.position.y = round ? 1.1 : 1.3;
    crown.rotation.y = rnd() * 6;
    tree.add(trunk, crown);
    const s = (0.75 + rnd() * 0.5) * grown;
    tree.scale.setScalar(s);
    tree.position.set(x, h - 0.05, z);
    g.add(tree);
    placed++;
  }
  // Bushes creeping in along the road on older islands.
  const brnd = mulberry32(hashString(seed + ":bushes"));
  const bushMat = mat("#4d6e38");
  const bushes = Math.round(growth * growth * 30);
  for (let placedB = 0, tries = 0; placedB < bushes && tries < 600; tries++) {
    const x = (brnd() - 0.5) * 22;
    const z = (brnd() - 0.5) * 30;
    const d = shape.roadDist(x, z);
    if (d < 1.1 || d > 2.4 || shape.edge(x, z) < 0.8) continue;
    const bush = new THREE.Mesh(new THREE.IcosahedronGeometry(0.35 + brnd() * 0.3, 0), bushMat);
    bush.position.set(x, shape.height(x, z, d) + 0.15, z);
    bush.scale.y = 0.7;
    g.add(bush);
    placedB++;
  }
  for (let k = 0; k < 10; k++) {
    const x = (rnd() - 0.5) * 18;
    const z = (rnd() - 0.5) * 26;
    if (shape.edge(x, z) < 0.6) continue;
    const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.3 + rnd() * 0.3, 0), rockMat);
    r.position.set(x, shape.height(x, z) + 0.2, z);
    r.rotation.set(rnd(), rnd(), rnd());
    g.add(r);
  }
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
  });
  return g;
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
