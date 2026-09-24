import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";

interface Shot {
  mesh: THREE.Mesh;
  a: THREE.Vector3;
  b: THREE.Vector3;
  t: number;
}
interface Puff {
  mesh: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  t: number;
}

interface Helicopter {
  group: THREE.Group;
  startPos: THREE.Vector3;
  t: number;
}

type FxApi = {
  /** `enemy` tracers are red. */
  shoot: (from: THREE.Vector3, to: THREE.Vector3, enemy?: boolean) => void;
  puff: (at: THREE.Vector3) => void;
  helicopter: (at: THREE.Vector3) => void;
};

/** Imperative handle so units can fire without re-rendering React. No-ops until the layer mounts. */
export const fx: FxApi = { shoot: () => {}, puff: () => {}, helicopter: () => {} };

const SHOT_TIME = 0.35;
const PUFF_TIME = 0.6;
const HELICOPTER_TIME = 2.0;

/** Tracers arc from a unit to a point ahead and burst into a puff of smoke. */
export function FxLayer() {
  const group = useRef<THREE.Group>(null);
  const shots = useRef<Shot[]>([]);
  const puffs = useRef<Puff[]>([]);
  const helicopters = useRef<Helicopter[]>([]);
  const res = useMemo(
    () => ({
      shotGeo: new THREE.SphereGeometry(0.12, 6, 4),
      shotMat: new THREE.MeshBasicMaterial({ color: "#ffd66b" }),
      enemyMat: new THREE.MeshBasicMaterial({ color: "#ff6a4d" }),
      puffGeo: new THREE.SphereGeometry(0.3, 8, 6),
    }),
    [],
  );

  useEffect(() => {
    fx.shoot = (from, to, enemy = false) => {
      const mesh = new THREE.Mesh(res.shotGeo, enemy ? res.enemyMat : res.shotMat);
      mesh.position.copy(from);
      group.current?.add(mesh);
      shots.current.push({ mesh, a: from.clone(), b: to.clone(), t: 0 });
    };
    fx.puff = (at) => {
      const mesh = new THREE.Mesh(res.puffGeo, new THREE.MeshBasicMaterial({ color: "#cfc8b8", transparent: true, opacity: 0.8 }));
      mesh.position.copy(at);
      group.current?.add(mesh);
      puffs.current.push({ mesh, t: 0 });
    };
    fx.helicopter = (at) => {
      const g = new THREE.Group();
      g.position.copy(at);
      // Helicopter body: a simple cylinder
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.2, 8), new THREE.MeshStandardMaterial({ color: "#4a4a4a" }));
      body.position.y = 0.1;
      g.add(body);
      // Rotor blades: a flat disk
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.02, 32), new THREE.MeshStandardMaterial({ color: "#666666", metalness: 0.6 }));
      rotor.position.y = 0.25;
      g.add(rotor);
      group.current?.add(g);
      helicopters.current.push({ group: g, startPos: at.clone(), t: 0 });
    };
    return () => {
      fx.shoot = () => {};
      fx.puff = () => {};
      fx.helicopter = () => {};
      res.shotGeo.dispose();
      res.shotMat.dispose();
      res.enemyMat.dispose();
      res.puffGeo.dispose();
    };
  }, [res]);

  useFrame((_, delta) => {
    const dt = Math.min(0.05, delta);
    const g = group.current;
    if (!g) return;
    shots.current = shots.current.filter((s) => {
      s.t += dt;
      const k = Math.min(1, s.t / SHOT_TIME);
      s.mesh.position.lerpVectors(s.a, s.b, k);
      s.mesh.position.y += Math.sin(k * Math.PI) * 0.6;
      if (k < 1) return true;
      g.remove(s.mesh);
      fx.puff(s.b);
      return false;
    });
    puffs.current = puffs.current.filter((p) => {
      p.t += dt;
      const k = p.t / PUFF_TIME;
      p.mesh.scale.setScalar(1 + k * 2);
      p.mesh.material.opacity = 0.8 * (1 - k);
      if (k < 1) return true;
      g.remove(p.mesh);
      p.mesh.material.dispose();
      return false;
    });
    helicopters.current = helicopters.current.filter((h) => {
      h.t += dt;
      const k = h.t / HELICOPTER_TIME;
      // Descend for first 0.4s, ascend for remaining 1.6s
      const descendTime = 0.4;
      const descendK = Math.min(1, k / (descendTime / HELICOPTER_TIME));
      const ascendK = Math.max(0, k - descendTime / HELICOPTER_TIME) / ((HELICOPTER_TIME - descendTime) / HELICOPTER_TIME);
      const y = descendK <= 1 ? -descendK * 3 : -3 + ascendK * 25;
      h.group.position.y = h.startPos.y + y;
      // Rotate rotor
      const rotor = (h.group.children[1] as THREE.Mesh);
      if (rotor) rotor.rotation.y += 0.3;
      if (k < 1) return true;
      g.remove(h.group);
      return false;
    });
  });

  return <group ref={group} />;
}
