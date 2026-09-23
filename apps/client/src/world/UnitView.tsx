import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { unitProgress, type Front, type Unit } from "@ww/shared";
import { anchors, unitAnchor } from "../overlay.ts";
import { GROUND_Y, laneFor, roadPoint, roadS } from "./road.ts";
import { UnitBody } from "./UnitModels.tsx";

interface Props {
  unit: Unit;
  front: Front;
  curve: THREE.CatmullRomCurve3;
  /** Island origin in world space, for the overlay anchor. */
  origin: [number, number];
  index: number;
  count: number;
  team: string;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
}

const BEACON = { working: "#ffd24a", waiting: "#ff5a3c" } as const;

/** A unit on its island's road. Moves toward its progress point and faces the way it travels. */
export function UnitView({ unit, front, curve, origin, index, count, team, selected, reduced, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const current = useRef<number | null>(null);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const target = roadS(unitProgress(unit, front));
  const lane = laneFor(index, count);

  useEffect(() => {
    const key = unitAnchor(unit.id);
    anchors.set(key, anchor);
    return () => void anchors.delete(key);
  }, [unit.id, anchor]);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    // New units march in from just behind HQ.
    if (current.current === null) current.current = reduced ? target : Math.max(0, target - 0.08);
    const s = reduced ? target : current.current + (target - current.current) * Math.min(1, dt * 1.5);
    current.current = s;
    const p = roadPoint(curve, s, lane);
    g.position.set(p.x, GROUND_Y, p.z);
    g.rotation.y = p.rot;
    if (body.current) {
      const bob = unit.status === "working" && !reduced ? Math.abs(Math.sin(clock.elapsedTime * 6 + index)) * 0.12 : 0;
      body.current.position.y = bob;
    }
    anchor.set(origin[0] + p.x, GROUND_Y + 2.2, origin[1] + p.z);
  });

  const beacon = unit.status === "working" || unit.status === "waiting" ? BEACON[unit.status] : null;

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
      {beacon && (
        <mesh position-y={1.75}>
          <sphereGeometry args={[0.2, 10, 8]} />
          <meshBasicMaterial color={beacon} />
        </mesh>
      )}
      {selected && (
        <mesh rotation-x={-Math.PI / 2} position-y={0.03}>
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
