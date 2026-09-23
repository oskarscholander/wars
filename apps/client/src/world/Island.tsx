import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { BUNKER_AT, type Front, type Unit } from "@ww/shared";
import { anchors, frontAnchor } from "../overlay.ts";
import { fx } from "./Fx.tsx";
import { COLORS, frontLook } from "./look.ts";
import { roadS } from "./road.ts";
import { toWorld, type Placement } from "./layout.ts";
import { ageOf, useNow } from "./age.ts";
import { Rubbish } from "./Rubbish.tsx";
import { Battle } from "./battle.ts";
import { EnemyForce } from "./Enemies.tsx";
import { buildProps, buildTerrain, disposeTree, islandShape, TERRAIN, type IslandShape } from "./terrain.ts";
import { NavGrid } from "./nav.ts";
import { UnitView } from "./UnitView.tsx";

interface Props {
  front: Front;
  units: Unit[];
  place: Placement;
  selectedUnitId: string | null;
  reduced: boolean;
  onSelect: () => void;
  onSelectUnit: (id: string) => void;
}

const BUNKER_RED = new THREE.Color("#7a3b2e");
const BUNKER_DEAD = new THREE.Color("#555550");

/** Failing tests: a bunker blocks the road. When they pass it sinks and greys out. */
function Bunker({ shape, up, place, reduced }: { shape: IslandShape; up: boolean; place: Placement; reduced: boolean }) {
  const p = useMemo(() => shape.roadPoint(roadS(BUNKER_AT)), [shape]);
  const group = useRef<THREE.Group>(null);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: BUNKER_RED, roughness: 0.9, flatShading: true }), []);
  const [visible, setVisible] = useState(up);
  const sinking = useRef(false);

  useEffect(() => {
    if (up) {
      sinking.current = false;
      mat.color.copy(BUNKER_RED);
      if (group.current) group.current.position.y = p.y;
      setVisible(true);
    } else if (visible) {
      if (reduced) setVisible(false);
      else {
        sinking.current = true;
        const w = toWorld(place, p.x, p.z);
        fx.puff(new THREE.Vector3(w.x, p.y + 1, w.z));
      }
    }
  }, [up, reduced, visible, mat, p, place]);

  useEffect(() => () => mat.dispose(), [mat]);

  useFrame((_, delta) => {
    const g = group.current;
    if (!g || !sinking.current) return;
    const dt = Math.min(0.05, delta);
    g.position.y -= dt * 0.9;
    mat.color.lerp(BUNKER_DEAD, dt * 2);
    if (g.position.y < p.y - 1.8) {
      sinking.current = false;
      setVisible(false);
    }
  });

  if (!visible) return null;
  return (
    <group ref={group} position={[p.x, p.y, p.z]} rotation-y={p.rot}>
      <mesh position-y={0.5} material={mat} castShadow receiveShadow>
        <cylinderGeometry args={[1.1, 1.4, 1, 7]} />
      </mesh>
      <mesh position-y={1.15} castShadow>
        <cylinderGeometry args={[0.7, 1.1, 0.35, 7]} />
        <meshStandardMaterial color="#6a3327" roughness={0.9} flatShading />
      </mesh>
      <mesh position={[0, 0.72, 1.1]}>
        <boxGeometry args={[1.3, 0.16, 0.1]} />
        <meshStandardMaterial color="#1a0f0c" />
      </mesh>
    </group>
  );
}

function Flag({ shape, color, reduced }: { shape: IslandShape; color: string; reduced: boolean }) {
  const p = useMemo(() => shape.roadPoint(0.97), [shape]);
  const cloth = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (cloth.current) cloth.current.rotation.y = reduced ? 0 : Math.sin(clock.elapsedTime * 2.2) * 0.18;
  });
  return (
    <group position={[p.x, p.y, p.z]}>
      <mesh position-y={1.6} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 3.2, 8]} />
        <meshStandardMaterial color={COLORS.pole} roughness={0.9} />
      </mesh>
      {/* Pivot at the pole so the cloth waves from its edge. */}
      <group ref={cloth} position-y={2.8}>
        <mesh position-x={0.72} castShadow>
          <boxGeometry args={[1.4, 0.8, 0.06]} />
          <meshStandardMaterial color={color} roughness={0.9} flatShading />
        </mesh>
      </group>
    </group>
  );
}

/** One worktree as an island: seeded terrain, road from HQ to the flag, props, bunker and units. */
export function Island({ front, units, place, selectedUnitId, reduced, onSelect, onSelectUnit }: Props) {
  const look = useMemo(() => frontLook(front), [front.branch, front.path]); // eslint-disable-line react-hooks/exhaustive-deps
  const seedKey = front.branch ?? front.path;
  const shape = useMemo(() => islandShape(seedKey), [seedKey]);
  const now = useNow();
  const { growth, rubbish } = ageOf(front.createdAt, now);
  const terrain = useMemo(() => buildTerrain(shape, look.ground, seedKey, growth), [shape, look.ground, seedKey, growth]);
  const props = useMemo(() => buildProps(shape, seedKey, growth), [shape, seedKey, growth]);
  const tent = useMemo(() => shape.roadPoint(0.03, -2.8), [shape]);
  const battle = useMemo(() => new Battle(), []);
  const bunkerAt = useMemo(() => shape.roadPoint(roadS(BUNKER_AT)), [shape]);
  const bunkerUp = front.tests.status === "failed";
  // Walkable ground: land, minus trees, rocks and the HQ tent. Rebuilt when the island grows.
  battle.nav = useMemo(
    () =>
      new NavGrid(shape, TERRAIN.width, TERRAIN.depth, [...props.userData.obstacles, { x: tent.x, z: tent.z, r: 1.5 }]),
    [shape, props, tent],
  );
  // Dev-only hook so browser tests can inspect the battlefield.
  if (import.meta.env.DEV) ((window as unknown as { __wwBattles?: Record<string, Battle> }).__wwBattles ??= {})[front.id] = battle;
  battle.nav.setDynamic("bunker", bunkerUp ? { x: bunkerAt.x, z: bunkerAt.z, r: 1.6 } : null);
  useEffect(() => () => terrain.dispose(), [terrain]);
  useEffect(() => () => disposeTree(props), [props]);

  // Anchor for the HTML branch label, just past HQ on the south shore.
  useEffect(() => {
    const key = frontAnchor(front.id);
    const hq = shape.roadPoint(0);
    const w = toWorld(place, hq.x, hq.z + 3);
    anchors.set(key, new THREE.Vector3(w.x, hq.y, w.z));
    return () => void anchors.delete(key);
  }, [front.id, place, shape]);

  const flagColor =
    front.pr?.state === "merged" ? look.team : front.pr?.state === "open" ? COLORS.brass : COLORS.flagEnemy;

  return (
    <group position={[place.x, 0, place.z]} rotation-y={place.yaw}>
      <mesh
        geometry={terrain}
        receiveShadow
        castShadow
        onClick={(e) => {
          e.stopPropagation();
          if (e.delta < 5) onSelect(); // a drag to orbit is not a click
        }}
      >
        <meshStandardMaterial vertexColors roughness={0.95} flatShading />
      </mesh>
      <primitive object={props} />
      <Rubbish shape={shape} seed={seedKey} level={rubbish} reduced={reduced} />

      <mesh position={[tent.x, tent.y + 0.75, tent.z]} rotation-y={Math.PI / 4 + tent.rot} castShadow>
        <coneGeometry args={[1.5, 1.6, 4]} />
        <meshStandardMaterial color={COLORS.tent} roughness={0.9} flatShading />
      </mesh>

      <Bunker shape={shape} up={front.tests.status === "failed"} place={place} reduced={reduced} />
      <Flag shape={shape} color={flagColor} reduced={reduced} />
      <EnemyForce battle={battle} shape={shape} place={place} bunker={bunkerUp ? bunkerAt : null} reduced={reduced} />

      {units.map((u, i) => (
        <UnitView
          key={u.id}
          unit={u}
          front={front}
          shape={shape}
          battle={battle}
          place={place}
          index={i}
          count={units.length}
          team={look.team}
          selected={u.id === selectedUnitId}
          reduced={reduced}
          onSelect={() => onSelectUnit(u.id)}
        />
      ))}
    </group>
  );
}
