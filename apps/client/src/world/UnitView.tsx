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
import { Mover, type Point } from "./nav.ts";
import type { UnitModel } from "@ww/shared";
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
/** Ground speed in island units per second. */
const SPEED: Record<UnitModel, number> = { opus: 1.7, sonnet: 1.5, haiku: 2.6 };
const BURST_MS = 1600;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * A unit on its island. Its progress point on the road is home: it walks there
 * along a real path when idle, and while working it moves between reachable
 * spots near it, faces and fires at the nearest enemy, and every tool call it
 * makes drops one.
 */
export function UnitView({ unit, front, shape, battle, place, index, count, team, selected, reduced, onSelect }: Props) {
  const group = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const beacon = useRef<THREE.Mesh>(null);
  const current = useRef<number | null>(null);
  const mover = useRef<Mover | null>(null);
  const home = useRef<Point | null>(null);
  const nextMove = useRef(0);
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
    const enemy = battle.nearestEnemy(me);
    const from = toWorld(place, me.x, me.z);
    tmp.from.set(from.x, me.y + 0.9, from.z);
    if (enemy) {
      const spread = aimed ? 0.2 : 1.4;
      const to = toWorld(place, enemy.mover.pos.x + rand(-spread, spread), enemy.mover.pos.z + rand(-spread, spread));
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
    const nav = battle.nav;
    if (!g || !nav) return;
    const dt = Math.min(0.05, delta);
    const now = performance.now();

    current.current = current.current === null ? progress : current.current + (progress - current.current) * Math.min(1, dt * 2);
    const bunkerS = roadS(BUNKER_AT) - 0.04;
    let s = roadS(current.current);
    if (bunkerUp) s = Math.min(s, bunkerS);
    const road = shape.roadPoint(s, lane);
    const spot = nav.nearestWalkable(road, 6) ?? road;

    // First frame: march in from HQ (or appear in place with reduced motion).
    if (!mover.current) {
      const hq = nav.nearestWalkable(shape.roadPoint(0.02, lane), 6) ?? spot;
      mover.current = new Mover(reduced ? { ...spot } : { ...hq }, SPEED[unit.model]);
      if (!reduced) mover.current.goTo(nav, spot);
      home.current = spot;
    }
    const m = mover.current;
    const homeMoved = !home.current || Math.hypot(home.current.x - spot.x, home.current.z - spot.z) > 0.6;
    if (homeMoved) home.current = spot;

    if (reduced) {
      m.pos.x = spot.x;
      m.pos.z = spot.z;
      m.path = [];
    } else if (working) {
      // Manoeuvre: pick a reachable spot near home, keep clear of the enemy, never past the bunker.
      if ((!m.moving && now > nextMove.current) || homeMoved) {
        const dest = nav.randomNear(home.current!, 0.5, 3, Math.random, (p) =>
          battle.distToEnemies(p) > 3.5 && (!bunkerUp || shape.nearestS(p.x, p.z) < bunkerS),
        );
        if (dest) m.goTo(nav, dest);
        nextMove.current = now + rand(1400, 3200);
      }
    } else if (homeMoved || (!m.moving && Math.hypot(m.pos.x - spot.x, m.pos.z - spot.z) > 0.3)) {
      m.goTo(nav, spot); // fall back into formation
    }
    const moved = reduced ? { x: 0, z: 0 } : m.step(dt);
    const p = m.pos;
    const y = shape.height(p.x, p.z);
    g.position.set(p.x, y, p.z);

    const enemy = working ? battle.nearestEnemy(p) : null;
    const walking = Math.hypot(moved.x, moved.z) > 1e-4;
    const face = walking
      ? headingTo(moved.x, moved.z)
      : enemy
        ? headingTo(enemy.mover.pos.x - p.x, enemy.mover.pos.z - p.z)
        : road.rot;
    g.rotation.y = reduced ? face : lerpAngle(g.rotation.y, face, Math.min(1, dt * 5));
    last.current = { x: p.x, y, z: p.z };
    const existing = battle.units.get(unit.id);
    if (existing) {
      existing.y = y;
      existing.s = shape.nearestS(p.x, p.z);
      existing.working = working;
    } else {
      battle.units.set(unit.id, { pos: m.pos, y, s: shape.nearestS(p.x, p.z), working });
    }

    const t = clock.elapsedTime;
    if (body.current) body.current.position.y = working && !reduced && !walking ? Math.abs(Math.sin(t * 9 + index)) * 0.04 : 0;
    if (beacon.current) beacon.current.scale.setScalar(reduced ? 1 : 1 + Math.sin(t * 5.5) * 0.25);
    const wp = toWorld(place, p.x, p.z);
    anchor.set(wp.x, y + 2.4, wp.z);

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
