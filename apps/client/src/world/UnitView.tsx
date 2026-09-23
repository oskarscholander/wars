import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { BUNKER_AT, unitProgress, type Front, type Unit } from "@ww/shared";
import { onTool } from "../events.ts";
import { anchors, unitAnchor } from "../overlay.ts";
import { headingTo, lerpAngle, type Battle } from "./battle.ts";
import { fx } from "./Fx.tsx";
import { laneFor, roadS } from "./road.ts";
import { toWorld, type Placement } from "./layout.ts";
import type { IslandShape } from "./terrain.ts";
import { UnitBody } from "./UnitModels.tsx";

interface Props {
  unit: Unit;
  front: Front;
  shape: IslandShape;
  battle: Battle;
  /** Island placement in world space. */
  place: Placement;
  index: number;
  count: number;
  team: string;
  selected: boolean;
  reduced: boolean;
  onSelect: () => void;
}

const BEACON = { working: "#ffd24a", waiting: "#ff5a3c" } as const;
const BURST_MS = 1600;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A unit on its island's road. It holds its progress point when idle; while
 * working it manoeuvres around that point, faces and fires at the nearest
 * enemy, and every tool call it makes drops one.
 */
export function UnitView({ unit, front, shape, battle, place, index, count, team, selected, reduced, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const current = useRef<number | null>(null);
  const wander = useRef({ s: 0, lane: 0, ts: 0, tl: 0, next: 0 });
  const last = useRef({ x: 0, y: 0, z: 0 });
  const fireUntil = useRef(0);
  const nextShot = useRef(0);
  const anchor = useMemo(() => new THREE.Vector3(), []);
  const tmp = useMemo(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3() }), []);
  const progress = unitProgress(unit, front);
  const lane = laneFor(index, count);
  const bunkerUp = front.tests.status === "failed";
  const working = unit.status === "working";

  useEffect(() => {
    const key = unitAnchor(unit.id);
    anchors.set(key, anchor);
    return () => {
      anchors.delete(key);
      battle.units.delete(unit.id);
    };
  }, [unit.id, anchor, battle]);

  /** Fires one tracer from the unit; returns the enemy it aimed at, if any. */
  const fire = (aimed: boolean) => {
    const me = last.current;
    const enemy = battle.nearestEnemy(me.x, me.z);
    const from = toWorld(place, me.x, me.z);
    tmp.from.set(from.x, me.y + 0.9, from.z);
    if (enemy) {
      const spread = aimed ? 0.2 : 1.4;
      const to = toWorld(place, enemy.x + rand(-spread, spread), enemy.z + rand(-spread, spread));
      tmp.to.set(to.x, enemy.y + 0.5, to.z);
    } else {
      const s = (current.current === null ? 0 : roadS(current.current)) + rand(0.14, 0.2);
      const q = shape.roadPoint(bunkerUp ? Math.min(s, roadS(BUNKER_AT)) : s, rand(-2, 2));
      const to = toWorld(place, q.x, q.z);
      tmp.to.set(to.x, q.y + (bunkerUp ? 0.6 : 0), to.z);
    }
    fx.shoot(tmp.from, tmp.to);
    return enemy;
  };

  // Every tool call is a volley and one aimed shot that drops the nearest enemy.
  useEffect(
    () =>
      onTool(unit.id, () => {
        fireUntil.current = performance.now() + BURST_MS;
        if (reduced) return;
        const hit = fire(true);
        if (hit) battle.kill(hit, performance.now() + 350);
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire reads refs only
    [unit.id, battle, reduced],
  );
  useEffect(() => {
    if (working) fireUntil.current = performance.now() + BURST_MS;
  }, [working]);

  useFrame(({ clock }, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(0.05, delta);
    const now = performance.now();

    // New units march in from behind HQ.
    if (current.current === null) current.current = reduced ? progress : Math.max(-0.05, progress - 0.1);
    current.current += (progress - current.current) * Math.min(1, dt * (reduced ? 10 : 1.2));

    // Manoeuvre around the progress point while fighting; fall back into formation otherwise.
    const w = wander.current;
    if (working && !reduced) {
      if (now > w.next) {
        w.ts = rand(-0.035, 0.035);
        w.tl = rand(-1.8, 1.8);
        w.next = now + rand(1100, 2600);
      }
    } else {
      w.ts = 0;
      w.tl = 0;
    }
    const k = reduced ? 1 : Math.min(1, dt * 1.3);
    w.s += (w.ts - w.s) * k;
    w.lane += (w.tl - w.lane) * k;

    let s = roadS(current.current) + w.s;
    if (bunkerUp) s = Math.min(s, roadS(BUNKER_AT) - 0.04);
    const p = shape.roadPoint(s, Math.max(-3.2, Math.min(3.2, lane + w.lane)));
    g.position.set(p.x, p.y, p.z);

    const enemy = working ? battle.nearestEnemy(p.x, p.z) : null;
    const face = enemy ? headingTo(enemy.x - p.x, enemy.z - p.z) : p.rot;
    g.rotation.y = reduced ? face : lerpAngle(g.rotation.y, face, Math.min(1, dt * 4));
    last.current = { x: p.x, y: p.y, z: p.z };
    battle.units.set(unit.id, { x: p.x, y: p.y, z: p.z, s, working });

    const t = clock.elapsedTime;
    if (body.current) body.current.position.y = working && !reduced ? Math.abs(Math.sin(t * 9 + index)) * 0.05 : 0;
    if (beacon.current) beacon.current.scale.setScalar(reduced ? 1 : 1 + Math.sin(t * 5.5) * 0.25);
    const wp = toWorld(place, p.x, p.z);
    anchor.set(wp.x, p.y + 2.4, wp.z);

    if (!reduced && working && now > nextShot.current && (now < fireUntil.current || enemy)) {
      // Rapid fire in a burst, steady suppressing fire otherwise.
      nextShot.current = now + (now < fireUntil.current ? rand(260, 460) : rand(900, 1600));
      fire(false);
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
        <UnitBody model={unit.model} team={team} active={working && !reduced} />
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
