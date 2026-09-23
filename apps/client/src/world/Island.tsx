import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { Front } from "@ww/shared";
import { anchors, frontAnchor } from "../overlay.ts";
import { COLORS, frontLook } from "./look.ts";

interface Props {
  front: Front;
  position: [number, number];
  onSelect: () => void;
}

/** Irregular coastline radius, same family of curves as the prototype. */
const coastRadius = (a: number, p: number[]) =>
  8.6 + 1.1 * Math.sin(3 * a + p[1]!) + 0.7 * Math.sin(5 * a + p[2]!) + 0.4 * Math.sin(8 * a + p[3]!);

function coastShape(phases: number[], scale: number): THREE.Shape {
  const shape = new THREE.Shape();
  const n = 72;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const r = coastRadius(a, phases) * scale;
    // Shape lives in XY; after rotateX(-90°) shape Y becomes world -Z.
    const x = r * Math.cos(a);
    const y = r * Math.sin(a) * 1.4;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  return shape;
}

function slab(shape: THREE.Shape, depth: number): THREE.ExtrudeGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: true,
    bevelSize: 0.5,
    bevelThickness: 0.35,
    bevelSegments: 1,
    curveSegments: 1,
  });
  geo.rotateX(-Math.PI / 2);
  return geo;
}

/**
 * Milestone 1 placeholder island: seeded coastline, beach, grass, HQ tent and
 * flag. The full terrain, road and props arrive in milestone 5.
 */
export function Island({ front, position, onSelect }: Props) {
  const look = useMemo(() => frontLook(front), [front]);
  const beach = useMemo(() => slab(coastShape(look.phases, 1.06), 1.4), [look]);
  const grass = useMemo(() => slab(coastShape(look.phases, 0.86), 1.4), [look]);

  // Anchor for the HTML branch label, just off the south shore.
  const [px, pz] = position;
  useEffect(() => {
    const key = frontAnchor(front.id);
    anchors.set(key, new THREE.Vector3(px, 1, pz + 13.5));
    return () => void anchors.delete(key);
  }, [front.id, px, pz]);

  const flagColor =
    front.pr?.state === "merged" ? look.team : front.pr?.state === "open" ? COLORS.brass : COLORS.flagEnemy;

  return (
    <group
      position={[position[0], 0, position[1]]}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <mesh geometry={beach} position-y={-1.5} receiveShadow>
        <meshStandardMaterial color={COLORS.sand} roughness={0.95} flatShading />
      </mesh>
      <mesh geometry={grass} position-y={-1.0} castShadow receiveShadow>
        <meshStandardMaterial color={look.ground} roughness={0.95} flatShading />
      </mesh>

      {/* HQ tent at the south end */}
      <mesh position={[-2.8, 1.55, 9.2]} rotation-y={Math.PI / 4} castShadow>
        <coneGeometry args={[1.5, 1.6, 4]} />
        <meshStandardMaterial color={COLORS.tent} roughness={0.9} flatShading />
      </mesh>

      {/* Objective flag at the north end */}
      <group position={[0, 0.75, -10.5]}>
        <mesh position-y={1.6} castShadow>
          <cylinderGeometry args={[0.06, 0.06, 3.2, 8]} />
          <meshStandardMaterial color={COLORS.pole} roughness={0.9} />
        </mesh>
        <mesh position={[0.72, 2.8, 0]} castShadow>
          <boxGeometry args={[1.4, 0.8, 0.06]} />
          <meshStandardMaterial color={flagColor} roughness={0.9} flatShading />
        </mesh>
      </group>

    </group>
  );
}
