import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { sortedFronts, sortedRepos, unitsOnFront, useStore } from "../store.ts";
import { useReducedMotion } from "../useReducedMotion.ts";
import { Island } from "./Island.tsx";
import { ISLAND_HALF, islandPositions } from "./layout.ts";
import { COLORS } from "./look.ts";
import { OverlayProjector } from "./OverlayProjector.tsx";
import { FxLayer } from "./Fx.tsx";

function Scene() {
  const war = useStore((s) => s.war);
  const selectedFrontId = useStore((s) => s.selectedFrontId);
  const selectFront = useStore((s) => s.selectFront);
  const selectedUnitId = useStore((s) => s.selectedUnitId);
  const selectUnit = useStore((s) => s.selectUnit);
  const reduced = useReducedMotion();
  const size = useThree((s) => s.size);
  const portrait = size.width < size.height;

  const fronts = useMemo(() => sortedFronts(war), [war]);
  const groups = useMemo(
    () => sortedRepos(war).map((r) => fronts.filter((f) => f.repoId === r.id).length),
    [war, fronts],
  );
  const groupKey = groups.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when the grouping changes
  const positions = useMemo(() => islandPositions(groups, portrait), [groupKey, portrait]);

  const focus = useMemo(() => {
    const box = new THREE.Box3();
    const add = ([x, z]: [number, number]) =>
      box.union(new THREE.Box3(new THREE.Vector3(x - ISLAND_HALF.x, 0, z - ISLAND_HALF.z), new THREE.Vector3(x + ISLAND_HALF.x, 3, z + ISLAND_HALF.z)));
    const i = fronts.findIndex((f) => f.id === selectedFrontId);
    if (i >= 0) add(positions[i]!);
    else if (positions.length) positions.forEach(add);
    else add([0, 0]);
    return box;
  }, [fronts, positions, selectedFrontId]);

  return (
    <>
      <color attach="background" args={[COLORS.sky]} />
      <fog attach="fog" args={[COLORS.sky, 80, 190]} />
      <hemisphereLight args={["#dfe8f0", "#2a2418", 0.9]} />
      <directionalLight
        position={[25, 45, 20]}
        intensity={2}
        color="#fff0d0"
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />

      <mesh rotation-x={-Math.PI / 2} receiveShadow onClick={() => selectFront(null)}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={COLORS.water} roughness={0.35} metalness={0.1} transparent opacity={0.86} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-2.2}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={COLORS.seabed} roughness={0.9} />
      </mesh>

      {fronts.map((f, i) => (
        <Island
          key={f.id}
          front={f}
          units={unitsOnFront(war, f.id)}
          position={positions[i]!}
          selectedUnitId={selectedUnitId}
          reduced={reduced}
          onSelectUnit={selectUnit}
          onSelect={() => selectFront(f.id === selectedFrontId && !selectedUnitId ? null : f.id)}
        />
      ))}

      <FxLayer />
      <CameraRig focus={focus} />
      <OverlayProjector />
    </>
  );
}

const DEFAULT_POLAR = 0.8;
const TOP_BAR_PX = 64;

/**
 * Frames the focused box between the top bar and the bottom panel, keeping the
 * user's current orbit angles. (camera-controls' fitToBox snaps angles to 90°.)
 */
function CameraRig({ focus }: { focus: THREE.Box3 }) {
  const ref = useRef<CameraControls>(null);
  const reduced = useReducedMotion();
  const first = useRef(true);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const polar = first.current ? DEFAULT_POLAR : c.polarAngle;
    const azimuth = first.current ? 0 : c.azimuthAngle;
    const animate = !reduced && !first.current;
    first.current = false;

    const panelPx = document.querySelector<HTMLElement>(".panel")?.offsetHeight ?? 140;
    const usable = Math.max(0.3, (size.height - TOP_BAR_PX - panelPx) / size.height);
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const aspect = size.width / size.height;

    const ext = focus.getSize(new THREE.Vector3());
    // Footprint as seen from this azimuth, then foreshortened by the polar angle.
    const across = Math.abs(ext.x * Math.cos(azimuth)) + Math.abs(ext.z * Math.sin(azimuth));
    const along = Math.abs(ext.x * Math.sin(azimuth)) + Math.abs(ext.z * Math.cos(azimuth));
    const tall = along * Math.cos(polar) + ext.y * Math.sin(polar);
    const dist = Math.max(across / 2 / (tanV * aspect), tall / 2 / (tanV * usable)) * 1.15;

    // Move the target toward the camera so content centres in the usable band.
    const worldPerPx = (2 * dist * tanV) / size.height;
    const shift = (((panelPx - TOP_BAR_PX) / 2) * worldPerPx) / Math.max(0.2, Math.cos(polar));
    const toward = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const target = focus.getCenter(new THREE.Vector3()).setY(0).addScaledVector(toward, shift);
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, polar, azimuth).add(target);

    void c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, animate);
  }, [focus, reduced, camera, size]);

  // Keep fog relative to how far out we are, so a wide overview is not swallowed.
  useFrame(({ scene }) => {
    const c = ref.current;
    if (!c || !(scene.fog instanceof THREE.Fog)) return;
    scene.fog.near = c.distance * 1.1;
    scene.fog.far = c.distance * 2.6;
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={12}
      maxDistance={400}
      minPolarAngle={0.2}
      maxPolarAngle={1.35}
      smoothTime={reduced ? 0 : 0.35}
    />
  );
}

export function World() {
  return (
    <Canvas shadows dpr={[1, 2]} camera={{ fov: 42, near: 0.1, far: 800, position: [0, 60, 60] }}>
      <Scene />
    </Canvas>
  );
}
