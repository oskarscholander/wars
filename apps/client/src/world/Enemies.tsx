import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { BUNKER_AT } from "@ww/shared";
import { Battle, headingTo, lerpAngle, type Enemy } from "./battle.ts";
import { fx } from "./Fx.tsx";
import { toWorld, type Placement } from "./layout.ts";
import { roadS } from "./road.ts";
import type { IslandShape } from "./terrain.ts";

const MAX_ENEMIES = 8;
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
  bunkerUp: boolean;
  reduced: boolean;
}

/**
 * The opposing force on one island. Soldiers turn up ahead of working units,
 * strafe and return fire; each hit from a unit's tool call drops one, more
 * arrive while the fight lasts, and survivors retreat when work stops.
 */
export function EnemyForce({ battle, shape, place, bunkerUp, reduced }: Props) {
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

  const spawn = (now: number) => {
    const lead = battle.leadS();
    const bunkerS = roadS(BUNKER_AT);
    const defend = bunkerUp && lead < bunkerS;
    const postS = defend ? bunkerS + rand(-0.02, 0.07) : Math.min(0.95, lead + rand(0.2, 0.36));
    const post = { s: postS, lane: rand(-3.6, 3.6) };
    const s = reduced ? post.s : Math.min(0.97, post.s + rand(0.06, 0.12));
    const object = makeSoldier(kit);
    const p = shape.roadPoint(s, post.lane);
    object.position.set(p.x, p.y, p.z);
    group.current?.add(object);
    battle.enemies.push({
      id: ++seq.current,
      s,
      lane: post.lane,
      x: p.x,
      y: p.y,
      z: p.z,
      post,
      offset: { s: 0, lane: 0, ts: 0, tl: 0 },
      state: reduced ? "fighting" : "arriving",
      t: 0,
      nextShot: now + rand(600, 1400),
      nextMove: now + rand(800, 2000),
      killAt: null,
      object,
    });
  };

  useFrame((_, delta) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(0.05, delta);
    const now = performance.now();
    const engaged = battle.engaged;
    const desired = engaged ? Math.min(MAX_ENEMIES, 1 + battle.workingCount() * 2 + (bunkerUp ? 2 : 0)) : 0;

    if (engaged && battle.aliveEnemies().length < desired && now > nextSpawn.current && battle.enemies.length < MAX_ENEMIES + 4) {
      spawn(now);
      nextSpawn.current = now + rand(900, 1800);
    }

    const keep: Enemy[] = [];
    for (const e of battle.enemies) {
      e.t += dt;
      if (e.killAt !== null && now >= e.killAt && (e.state === "arriving" || e.state === "fighting")) {
        e.state = "dying";
        e.t = 0;
        const w = toWorld(place, e.x, e.z);
        fx.puff(new THREE.Vector3(w.x, e.y + 0.5, w.z));
      }
      if (!engaged && (e.state === "arriving" || e.state === "fighting")) {
        e.state = "leaving";
        e.t = 0;
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

      if (e.state === "leaving") {
        if (reduced || e.t > 3 || e.s > 0.97) {
          g.remove(e.object);
          continue;
        }
        e.s = Math.min(0.99, e.s + dt * 0.09);
        if (e.t > 2) e.object.position.y -= dt * 0.8;
      } else if (e.state === "arriving") {
        e.s += (e.post.s - e.s) * Math.min(1, dt * 1.4);
        if (Math.abs(e.s - e.post.s) < 0.01) e.state = "fighting";
      } else if (!reduced) {
        // Strafe around the post.
        if (now > e.nextMove) {
          e.offset.ts = rand(-0.025, 0.025);
          e.offset.tl = rand(-1.2, 1.2);
          e.nextMove = now + rand(1200, 2600);
        }
        e.offset.s += (e.offset.ts - e.offset.s) * Math.min(1, dt * 1.6);
        e.offset.lane += (e.offset.tl - e.offset.lane) * Math.min(1, dt * 1.6);
        e.s = e.post.s + e.offset.s;
        e.lane = Math.max(-4, Math.min(4, e.post.lane + e.offset.lane));
      }

      const p = shape.roadPoint(e.s, e.lane);
      e.x = p.x;
      e.z = p.z;
      e.y = p.y;
      if (e.state !== "leaving" || e.t <= 2) e.object.position.set(p.x, p.y, p.z);
      else e.object.position.set(p.x, e.object.position.y, p.z);

      const target = battle.nearestUnit(e.x, e.z);
      const face = e.state === "leaving" ? p.rot + Math.PI : target ? headingTo(target.x - e.x, target.z - e.z) : p.rot + Math.PI;
      e.object.rotation.y = lerpAngle(e.object.rotation.y, face, Math.min(1, dt * 6));

      if (!reduced && e.state === "fighting" && target && now > e.nextShot) {
        e.nextShot = now + rand(900, 1800);
        const a = toWorld(place, e.x, e.z);
        const b = toWorld(place, target.x + rand(-0.8, 0.8), target.z + rand(-0.8, 0.8));
        tmp.from.set(a.x, e.y + 0.6, a.z);
        tmp.to.set(b.x, target.y + 0.3, b.z);
        fx.shoot(tmp.from, tmp.to, true);
      }
      keep.push(e);
    }
    battle.enemies = keep;
  });

  return <group ref={group} />;
}
