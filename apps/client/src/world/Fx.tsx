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

type FxApi = { shoot: (from: THREE.Vector3, to: THREE.Vector3) => void; puff: (at: THREE.Vector3) => void };

/** Imperative handle so units can fire without re-rendering React. No-ops until the layer mounts. */
export const fx: FxApi = { shoot: () => {}, puff: () => {} };

const SHOT_TIME = 0.35;
const PUFF_TIME = 0.6;

/** Tracers arc from a unit to a point ahead and burst into a puff of smoke. */
export function FxLayer() {
  const group = useRef<THREE.Group>(null);
  const shots = useRef<Shot[]>([]);
  const puffs = useRef<Puff[]>([]);
  const res = useMemo(
    () => ({
      shotGeo: new THREE.SphereGeometry(0.12, 6, 4),
      shotMat: new THREE.MeshBasicMaterial({ color: "#ffd66b" }),
      puffGeo: new THREE.SphereGeometry(0.3, 8, 6),
    }),
    [],
  );

  useEffect(() => {
    fx.shoot = (from, to) => {
      const mesh = new THREE.Mesh(res.shotGeo, res.shotMat);
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
    return () => {
      fx.shoot = () => {};
      fx.puff = () => {};
      res.shotGeo.dispose();
      res.shotMat.dispose();
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
  });

  return <group ref={group} />;
}
