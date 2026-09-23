import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { Battle, headingTo, lerpAngle, type Enemy } from "./battle.ts";
import { fx } from "./Fx.tsx";
import { toWorld, type Placement } from "./layout.ts";
import { Mover, separate, type Body, type Point } from "./nav.ts";
import type { IslandShape } from "./terrain.ts";

const MAX_ENEMIES = 8;
const SPEED = 1.4;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Kit {
  body: THREE.CylinderGeometry;
  head: THREE.SphereGeometry;
  helmet: THREE.SphereGeometry;
  gun: THREE.BoxGeometry;
  uniform: THREE.MeshStandardMaterial;
  skin: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
}

/** One enemy soldier: grey uniform, red helmet, rifle. Pivot at the feet so it can topple. */
function makeSoldier(k: Kit): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(k.body, k.uniform);
  body.position.y = 0.3;
  const head = new THREE.Mesh(k.head, k.skin);
  head.position.y = 0.7;
  const helmet = new THREE.Mesh(k.helmet, k.red);
  helmet.position.y = 0.73;
  const gun = new THREE.Mesh(k.gun, k.dark);
  gun.position.set(0.17, 0.4, -0.2);
  g.add(body, head, helmet, gun);
  g.traverse((o) => {
    if (o instanceof THREE.Mesh) o.castShadow = true;
  });
  g.scale.setScalar(1.15);
  return g;
}

interface Props {
  battle: Battle;
  shape: IslandShape;
  place: Placement;
  /** Island-local bunker position while it stands, else null. */
  bunker: Point | null;
  reduced: boolean;
}

/**
 * The opposing force on one island. Soldiers come ashore from the far end of
 * the island, walk real paths to cover a few metres from the working units,
 * shift between spots on land and return fire. Each hit from a unit's tool call
 * drops one; survivors retreat when work stops.
 */
export function EnemyForce({ battle, shape, place, bunker, reduced }: Props) {
  const group = useRef<THREE.Group>(null);
  const nextSpawn = useRef(0);
  const seq = useRef(0);
  const tmp = useMemo(() => ({ from: new THREE.Vector3(), to: new THREE.Vector3() }), []);
  const kit = useMemo<Kit>(
    () => ({
      body: new THREE.CylinderGeometry(0.15, 0.19, 0.55, 8),
      head: new THREE.SphereGeometry(0.14, 8, 6),
      helmet: new THREE.SphereGeometry(0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2),
      gun: new THREE.BoxGeometry(0.06, 0.06, 0.55),
      uniform: new THREE.MeshStandardMaterial({ color: "#3d4046", roughness: 0.9, flatShading: true }),
      skin: new THREE.MeshStandardMaterial({ color: "#d9b48f", roughness: 0.9, flatShading: true }),
      red: new THREE.MeshStandardMaterial({ color: "#a3261b", roughness: 0.8, flatShading: true }),
      dark: new THREE.MeshStandardMaterial({ color: "#2e3326", roughness: 0.9, flatShading: true }),
    }),
    [],
  );

  useEffect(
    () => () => {
      for (const e of battle.enemies) group.current?.remove(e.object);
      battle.enemies = [];
      Object.values(kit).forEach((r) => r.dispose());
    },
    [battle, kit],
  );

  /** Somewhere on land, well away from every unit, preferring the flag end. */
  const pickHome = (lead: Point, leadS: number): Point | null => {
    const nav = battle.nav!;
    const flag = nav.nearestWalkable(shape.roadPoint(0.97));
    if (flag && battle.distToUnits(flag) > 9) return flag;
    return (
      nav.randomNear(lead, 9, 16, Math.random, (p) => battle.distToUnits(p) > 8 && shape.nearestS(p.x, p.z) > leadS) ??
      nav.randomNear(lead, 8, 18, Math.random, (p) => battle.distToUnits(p) > 7)
    );
  };

  /** Cover a few metres from the units, on land, ahead up the road if possible (or around the bunker). */
  const pickPost = (lead: Point, leadS: number): Point | null => {
    const nav = battle.nav!;
    const spaced = (p: Point) => battle.distToEnemies(p) > 1.4;
    if (bunker && leadS < shape.nearestS(bunker.x, bunker.z)) {
      const p = nav.randomNear(bunker, 1.8, 4, Math.random, (q) => battle.distToUnits(q) > 4 && spaced(q));
      if (p) return p;
    }
    return (
      nav.randomNear(lead, 5.5, 9.5, Math.random, (p) => battle.distToUnits(p) > 5 && spaced(p) && shape.nearestS(p.x, p.z) >= leadS) ??
      nav.randomNear(lead, 5, 10, Math.random, (p) => battle.distToUnits(p) > 4.5 && spaced(p))
    );
  };

  const spawn = (now: number) => {
    const lead = battle.lead();
    if (!lead || !battle.nav) return;
    const home = pickHome(lead.pos, lead.s);
    const post = pickPost(lead.pos, lead.s);
    if (!home || !post) return;
    const mover = new Mover(reduced ? { ...post } : { ...home }, SPEED);
    if (!reduced && !mover.goTo(battle.nav, post)) return;
    const object = makeSoldier(kit);
    object.position.set(mover.pos.x, shape.height(mover.pos.x, mover.pos.z), mover.pos.z);
    group.current?.add(object);
    battle.enemies.push({
      id: ++seq.current,
      mover,
      y: shape.height(mover.pos.x, mover.pos.z),
      post,
      home,
      state: reduced ? "fighting" : "arriving",
      t: 0,
      nextShot: now + rand(800, 1600),
      nextMove: now + rand(1500, 3000),
      killAt: null,
      object,
    });
  };

  useFrame((_, delta) => {
    const g = group.current;
    const nav = battle.nav;
    if (!g || !nav) return;
    const dt = Math.min(0.05, delta);
    const now = performance.now();
    const engaged = battle.engaged;
    const desired = engaged ? Math.min(MAX_ENEMIES, 1 + battle.workingCount() * 2 + (bunker ? 2 : 0)) : 0;

    if (engaged && battle.aliveEnemies().length < desired && now > nextSpawn.current && battle.enemies.length < MAX_ENEMIES + 4) {
      spawn(now);
      nextSpawn.current = now + rand(900, 1800);
    }

    const keep: Enemy[] = [];
    for (const e of battle.enemies) {
      e.t += dt;
      const pos = e.mover.pos;
      if (e.killAt !== null && now >= e.killAt && (e.state === "arriving" || e.state === "fighting")) {
        e.state = "dying";
        e.t = 0;
        e.mover.path = [];
        const w = toWorld(place, pos.x, pos.z);
        fx.puff(new THREE.Vector3(w.x, e.y + 0.5, w.z));
      }
      if (!engaged && (e.state === "arriving" || e.state === "fighting")) {
        e.state = "leaving";
        e.t = 0;
        e.mover.goTo(nav, e.home);
      }

      if (e.state === "dying") {
        if (reduced) {
          g.remove(e.object);
          continue;
        }
        // Topple backwards, lie there, then sink into the ground.
        e.object.rotation.x = Math.min(Math.PI / 2, (e.t / 0.35) * (Math.PI / 2));
        if (e.t > 1.6) e.object.position.y -= dt * 0.5;
        if (e.t > 3.2) {
          g.remove(e.object);
          continue;
        }
        keep.push(e);
        continue;
      }

      let moved = { x: 0, z: 0 };
      if (e.state === "leaving") {
        if (reduced || e.t > 6 || (!e.mover.moving && e.t > 0.5)) {
          // Out of sight behind the lines: fade into the ground.
          e.object.position.y -= dt * 1.2;
          if (reduced || e.object.position.y < e.y - 1.2) {
            g.remove(e.object);
            continue;
          }
          keep.push(e);
          continue;
        }
        moved = e.mover.step(dt);
      } else if (e.state === "arriving") {
        moved = reduced ? moved : e.mover.step(dt);
        if (!e.mover.moving) e.state = "fighting";
      } else if (!reduced) {
        // Shift between spots near the post, never closer than a few metres to a unit.
        if (!e.mover.moving && now > e.nextMove) {
          const spot = nav.randomNear(e.post, 0.5, 2.2, Math.random, (p) => battle.distToUnits(p) > 4);
          if (spot) e.mover.goTo(nav, spot);
          e.nextMove = now + rand(1800, 3600);
        }
        moved = e.mover.step(dt);
      }

      e.y = shape.height(pos.x, pos.z);
      e.object.position.set(pos.x, e.y, pos.z);

      const target = battle.nearestUnit(pos);
      const walking = Math.hypot(moved.x, moved.z) > 1e-4;
      const face = walking
        ? headingTo(moved.x, moved.z)
        : target
          ? headingTo(target.pos.x - pos.x, target.pos.z - pos.z)
          : e.object.rotation.y;
      e.object.rotation.y = reduced ? face : lerpAngle(e.object.rotation.y, face, Math.min(1, dt * 7));

      if (!reduced && e.state === "fighting" && !walking && target && now > e.nextShot) {
        e.nextShot = now + rand(900, 1800);
        const a = toWorld(place, pos.x, pos.z);
        const b = toWorld(place, target.pos.x + rand(-0.8, 0.8), target.pos.z + rand(-0.8, 0.8));
        tmp.from.set(a.x, e.y + 0.6, a.z);
        tmp.to.set(b.x, target.y + 0.3, b.z);
        fx.shoot(tmp.from, tmp.to, true);
      }
      keep.push(e);
    }
    battle.enemies = keep;

    // Keep everyone from standing inside each other; vehicles need more room than soldiers.
    const bodies: Body[] = [...battle.units.values()].map((u) => ({ pos: u.pos, r: u.r }));
    for (const e of keep) if (e.state === "arriving" || e.state === "fighting") bodies.push({ pos: e.mover.pos, r: 0.45 });
    separate(nav, bodies);
  });

  return <group ref={group} />;
}
