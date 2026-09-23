import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { BUNKER_AT, unitProgress, type Front, type Unit } from "@ww/shared";
import { onTool } from "../events.ts";
import { anchors, unitAnchor } from "../overlay.ts";
import { fx } from "./Fx.tsx";
import { laneFor, roadS } from "./road.ts";
import type { IslandShape } from "./terrain.ts";
import { UnitBody } from "./UnitModels.tsx";

interface Props {
  unit: Unit;
  front: Front;
  shape: IslandShape;
  /** Island origin in world space. */
  origin: [number, number];
  index: number;
  count: number;
  team: string;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
}

const BEACON = { working: "#ffd24a", waiting: "#ff5a3c" } as const;
const BURST_MS = 1600;

/** A unit on its island's road: follows the terrain, faces the flag, fires while it works. */
export function UnitView({ unit, front, shape, origin, index, count, team, selected, reduced, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const current = useRef<number | null>(null);
  const fireUntil = useRef(0);
  const nextShot = useRef(0);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3() }), []);
  const progress = unitProgress(unit, front);
  const lane = laneFor(index, count);
  const bunkerUp = front.tests.status === "failed";

  useEffect(() => {
    const key = unitAnchor(unit.id);
    anchors.set(key, anchor);
    return () => void anchors.delete(key);
  }, [unit.id, anchor]);

  // Every tool call is a volley; starting work fires one too.
  useEffect(() => onTool(unit.id, () => (fireUntil.current = performance.now() + BURST_MS)), [unit.id]);
  useEffect(() => {
    if (unit.status === "working") fireUntil.current = performance.now() + BURST_MS;
  }, [unit.status]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(0.05, delta);
    // New units march in from behind HQ.
    if (current.current === null) current.current = reduced ? progress : Math.max(-0.05, progress - 0.1);
    current.current += (progress - current.current) * Math.min(1, dt * (reduced ? 10 : 1.2));
    const p = shape.roadPoint(roadS(current.current), lane);
    g.position.set(p.x, p.y, p.z);
    g.rotation.y = p.rot;

    const t = clock.elapsedTime;
    if (body.current) body.current.position.y = unit.status === "working" && !reduced ? Math.sin(t * 11) * 0.04 : 0;
    if (beacon.current) beacon.current.scale.setScalar(reduced ? 1 : 1 + Math.sin(t * 5.5) * 0.25);
    anchor.set(origin[0] + p.x, p.y + 2.4, origin[1] + p.z);

    const now = performance.now();
    if (!reduced && now < fireUntil.current && now > nextShot.current) {
      nextShot.current = now + 280 + Math.random() * 200;
      tmp.from.set(origin[0] + p.x, p.y + 0.9, origin[1] + p.z);
      const nearBunker = bunkerUp && current.current > BUNKER_AT - 0.2;
      const q = nearBunker
        ? shape.roadPoint(roadS(BUNKER_AT), (Math.random() - 0.5) * 1.5)
        : shape.roadPoint(roadS(current.current) + 0.14 + Math.random() * 0.06, (Math.random() - 0.5) * 4);
      tmp.to.set(origin[0] + q.x, q.y + (nearBunker ? 0.6 : 0), origin[1] + q.z);
      fx.shoot(tmp.from, tmp.to);
    }
  });

  const beaconColor = unit.status === "working" || unit.status === "waiting" ? BEACON[unit.status] : null;

  return (
    <group
      ref={group}
      onClick={(e) => {
        e.stopPropagation();
        onSelect();
      }}
    >
      <group ref={body}>
        <UnitBody model={unit.model} team={team} />
      </group>
      {beaconColor && (
        <mesh ref={beacon} position-y={2.1}>
          <sphereGeometry args={[0.2, 10, 8]} />
          <meshBasicMaterial color={beaconColor} />
        </mesh>
      )}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.12}>
          <ringGeometry args={[1.35, 1.6, 40]} />
          <meshBasicMaterial color="#d4a93a" transparent opacity={0.9} />
        </mesh>
      )}
      {/* Generous invisible hit target so small units are easy to tap. */}
      <mesh position-y={0.7} visible={false}>
        <boxGeometry args={[2, 1.6, 2.4]} />
      </mesh>
    </group>
  );
}
