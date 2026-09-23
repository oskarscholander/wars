import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { hashString, mulberry32 } from "./seed.ts";
import { disposeTree, type IslandShape } from "./terrain.ts";

const MAX_ITEMS = 32;

const mat = (color: string, roughness = 0.9) => new THREE.MeshStandardMaterial({ color, roughness, flatShading: true });

type Maker = (rnd: () => number) => THREE.Object3D;

/** Low-poly junk: crates, barrels, tyres, planks and bottles. */
const MAKERS: Maker[] = [
  (rnd) => new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.6), mat(rnd() < 0.5 ? "#8a6a3f" : "#6f5533")),
  (rnd) => {
    const colors = ["#8c3b2a", "#35557a", "#4a4a44", "#9a7b2e"];
    return new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.75, 10), mat(colors[Math.floor(rnd() * colors.length)]!, 0.7));
  },
  () => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.12, 6, 12), mat("#232320"));
    m.rotation.x = Math.PI / 2;
    const g = new THREE.Group();
    g.add(m);
    return g;
  },
  (rnd) => new THREE.Mesh(new THREE.BoxGeometry(1.1 + rnd() * 0.6, 0.07, 0.22), mat("#9b8360")),
  (rnd) => new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.35, 6), mat(rnd() < 0.5 ? "#dfe8e4" : "#5f8a55", 0.4)),
];

interface Junk {
  object: THREE.Object3D;
  floating: boolean;
  phase: number;
  baseY: number;
}

/**
 * Items are placed in a fixed seeded sequence and only the first `count` are
 * shown, so an island collects junk as it ages rather than reshuffling it.
 */
function buildJunk(shape: IslandShape, seed: string): Junk[] {
  const rnd = mulberry32(hashString(seed + ":rubbish"));
  const junk: Junk[] = [];
  for (let tries = 0; junk.length < MAX_ITEMS && tries < 4000; tries++) {
    const x = (rnd() - 0.5) * 34;
    const z = (rnd() - 0.5) * 44;
    const h = shape.height(x, z);
    const e = shape.edge(x, z);
    const onBeach = h > -0.35 && h < 0.3 && e > 0.3;
    const offshore = h < -0.8 && e > 0.01 && e < 0.35;
    if (!onBeach && !offshore) continue;
    const object = MAKERS[Math.floor(rnd() * MAKERS.length)]!(rnd);
    const floating = offshore;
    const baseY = floating ? 0.02 : h + 0.12;
    object.position.set(x, baseY, z);
    object.rotation.y = rnd() * Math.PI * 2;
    if (!floating) object.rotation.z = (rnd() - 0.5) * 0.9; // tipped over on the sand
    object.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = o.receiveShadow = true;
    });
    junk.push({ object, floating, phase: rnd() * Math.PI * 2, baseY });
  }
  return junk;
}

/** Rubbish washed up on the beach and bobbing offshore; more of it the older the worktree. */
export function Rubbish({ shape, seed, level, reduced }: { shape: IslandShape; seed: string; level: number; reduced: boolean }) {
  const junk = useMemo(() => buildJunk(shape, seed), [shape, seed]);
  const group = useRef<THREE.Group>(null);
  const count = Math.round(level * MAX_ITEMS);

  useEffect(() => {
    const g = group.current;
    if (!g) return;
    junk.forEach((j, i) => {
      if (i < count) g.add(j.object);
      else g.remove(j.object);
    });
  }, [junk, count]);

  useEffect(
    () => () => {
      for (const j of junk) disposeTree(j.object);
    },
    [junk],
  );

  useFrame(({ clock }) => {
    if (reduced) return;
    const t = clock.elapsedTime;
    for (let i = 0; i < count && i < junk.length; i++) {
      const j = junk[i]!;
      if (!j.floating) continue;
      j.object.position.y = j.baseY + Math.sin(t * 1.3 + j.phase) * 0.07;
      j.object.rotation.z = Math.sin(t * 0.9 + j.phase) * 0.15;
    }
  });

  return <group ref={group} />;
}
