import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { CameraControls } from "@react-three/drei";
import { sortedFronts, sortedRepos, unitsOnFront, useStore } from "../store.ts";
import { useReducedMotion } from "../useReducedMotion.ts";
import { Island } from "./Island.tsx";
import { ISLAND_RADIUS, scatterIslands, type Placement } from "./layout.ts";
import { COLORS } from "./look.ts";
import { OverlayProjector } from "./OverlayProjector.tsx";
import { FxLayer } from "./Fx.tsx";

function Scene() {
  const war = useStore((s) => s.war);
  const selectFront = useStore((s) => s.selectFront);
  const clearSelection = useStore((s) => s.clearSelection);
  const selectedUnitId = useStore((s) => s.selectedUnitId);
  const selectUnit = useStore((s) => s.selectUnit);
  const reduced = useReducedMotion();
  const size = useThree((s) => s.size);
  const portrait = size.width < size.height;

  const fronts = useMemo(() => sortedFronts(war), [war]);
  // Oldest first within each repo, so a new worktree never moves the islands already on the map.
  const groups = useMemo(
    () =>
      sortedRepos(war).map((r) => ({
        key: r.id,
        ids: fronts
          .filter((f) => f.repoId === r.id)
          .sort((a, b) => (a.createdAt ?? Infinity) - (b.createdAt ?? Infinity) || a.path.localeCompare(b.path))
          .map((f) => f.id),
      })),
    [war, fronts],
  );
  const groupKey = JSON.stringify(groups);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recompute only when membership or order changes
  const places = useMemo(() => scatterIslands(groups, portrait), [groupKey, portrait]);

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

      <mesh
        rotation-x={-Math.PI / 2}
        receiveShadow
        onClick={(e) => {
          if (e.delta < 5) clearSelection(); // a drag to orbit is not a click
        }}
      >
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={COLORS.water} roughness={0.35} metalness={0.1} transparent opacity={0.86} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position-y={-2.2}>
        <planeGeometry args={[600, 600]} />
        <meshStandardMaterial color={COLORS.seabed} roughness={0.9} />
      </mesh>

      {fronts.map((f) => (
        <Island
          key={f.id}
          front={f}
          units={unitsOnFront(war, f.id)}
          place={places.get(f.id) ?? { x: 0, z: 0, yaw: 0 }}
          selectedUnitId={selectedUnitId}
          reduced={reduced}
          onSelectUnit={selectUnit}
          onSelect={() => selectFront(f.id)}
        />
      ))}

      <FxLayer />
      <CameraRig places={places} />
      <OverlayProjector />
    </>
  );
}

const DEFAULT_POLAR = 0.8;
const TOP_BAR_PX = 64;

const islandBox = (p: Placement) =>
  new THREE.Box3(
    new THREE.Vector3(p.x - ISLAND_RADIUS, 0, p.z - ISLAND_RADIUS),
    new THREE.Vector3(p.x + ISLAND_RADIUS, 3, p.z + ISLAND_RADIUS),
  );

/**
 * Moves the camera only when asked (the store's `camera.tick`), keeping the
 * user's orbit angles. The overview frames every island; going to an island
 * pans there and zooms in if needed, but never zooms out from a closer view.
 * (camera-controls' fitToBox snaps angles to 90°, so framing is done by hand.)
 */
function CameraRig({ places }: { places: Map<string, Placement> }) {
  const ref = useRef<CameraControls>(null);
  const reduced = useReducedMotion();
  const first = useRef(true);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const goal = useStore((s) => s.camera);
  const hasIslands = places.size > 0;
  const placesRef = useRef(places);
  placesRef.current = places;

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    // The very first framing waits for the islands to arrive.
    if (first.current && !hasIslands) return;
    const focus = new THREE.Box3();
    const dest = goal.kind === "front" && goal.frontId ? placesRef.current.get(goal.frontId) : undefined;
    if (dest) focus.union(islandBox(dest));
    else if (goal.kind === "overview" || first.current) placesRef.current.forEach((p) => focus.union(islandBox(p)));
    if (focus.isEmpty()) return;
    const zoomIn = !!dest && !first.current;
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
    const fit = Math.max(across / 2 / (tanV * aspect), tall / 2 / (tanV * usable)) * 1.15;
    const dist = zoomIn ? Math.min(c.distance, fit) : fit;

    // Move the target toward the camera so content centres in the usable band.
    const worldPerPx = (2 * dist * tanV) / size.height;
    const shift = (((panelPx - TOP_BAR_PX) / 2) * worldPerPx) / Math.max(0.2, Math.cos(polar));
    const toward = new THREE.Vector3(Math.sin(azimuth), 0, Math.cos(azimuth));
    const target = focus.getCenter(new THREE.Vector3()).setY(0).addScaledVector(toward, shift);
    const pos = new THREE.Vector3().setFromSphericalCoords(dist, polar, azimuth).add(target);

    void c.setLookAt(pos.x, pos.y, pos.z, target.x, target.y, target.z, animate);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- move only on explicit requests (tick) or first islands
  }, [goal.tick, hasIslands]);

  // Dev-only hook so browser tests can read the camera distance.
  useEffect(() => {
    if (import.meta.env.DEV) (window as unknown as { __wwCamera?: CameraControls | null }).__wwCamera = ref.current;
  });

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
