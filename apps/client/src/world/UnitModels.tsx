import type { UnitModel } from "@ww/shared";

const OLIVE = "#5b6436";
const DARK = "#2e3326";
const SKIN = "#d9b48f";

function Mat({ color }: { color: string }) {
  return <meshStandardMaterial color={color} roughness={0.9} flatShading />;
}

/** Opus: tank. */
function Tank({ team }: { team: string }) {
  return (
    <group>
      <mesh position-y={0.45} castShadow>
        <boxGeometry args={[1.5, 0.5, 2.1]} />
        <Mat color={OLIVE} />
      </mesh>
      {[-0.8, 0.8].map((x) => (
        <mesh key={x} position={[x, 0.3, 0]} castShadow>
          <boxGeometry args={[0.38, 0.5, 2.25]} />
          <Mat color={DARK} />
        </mesh>
      ))}
      <mesh position-y={0.92} castShadow>
        <boxGeometry args={[0.95, 0.42, 0.95]} />
        <Mat color={team} />
      </mesh>
      <mesh position={[0, 0.95, -1]} rotation-x={Math.PI / 2} castShadow>
        <cylinderGeometry args={[0.08, 0.08, 1.3, 8]} />
        <Mat color={DARK} />
      </mesh>
    </group>
  );
}

const SQUAD: [number, number][] = [
  [-0.45, 0.3],
  [0.45, 0.3],
  [0, -0.4],
];

/** Sonnet: infantry squad. */
function Squad({ team }: { team: string }) {
  return (
    <group>
      {SQUAD.map(([x, z]) => (
        <group key={`${x},${z}`} position={[x, 0, z]}>
          <mesh position-y={0.3} castShadow>
            <cylinderGeometry args={[0.15, 0.19, 0.55, 8]} />
            <Mat color={OLIVE} />
          </mesh>
          <mesh position-y={0.7} castShadow>
            <sphereGeometry args={[0.14, 8, 6]} />
            <Mat color={SKIN} />
          </mesh>
          <mesh position-y={0.73} castShadow>
            <sphereGeometry args={[0.16, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2]} />
            <Mat color={team} />
          </mesh>
          <mesh position={[0.17, 0.4, -0.2]} castShadow>
            <boxGeometry args={[0.06, 0.06, 0.55]} />
            <Mat color={DARK} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

const WHEELS: [number, number][] = [
  [-0.55, -0.5],
  [0.55, -0.5],
  [-0.55, 0.5],
  [0.55, 0.5],
];

/** Haiku: scout car. */
function Scout({ team }: { team: string }) {
  return (
    <group>
      <mesh position-y={0.45} castShadow>
        <boxGeometry args={[1, 0.4, 1.5]} />
        <Mat color={OLIVE} />
      </mesh>
      <mesh position={[0, 0.8, 0.2]} castShadow>
        <boxGeometry args={[0.85, 0.32, 0.6]} />
        <Mat color={team} />
      </mesh>
      {WHEELS.map(([x, z]) => (
        <mesh key={`${x},${z}`} position={[x, 0.22, z]} rotation-z={Math.PI / 2} castShadow>
          <cylinderGeometry args={[0.22, 0.22, 0.18, 10]} />
          <Mat color={DARK} />
        </mesh>
      ))}
    </group>
  );
}

export function UnitBody({ model, team }: { model: UnitModel; team: string }) {
  if (model === "opus") return <Tank team={team} />;
  if (model === "haiku") return <Scout team={team} />;
  return <Squad team={team} />;
}

export const UNIT_KIND: Record<UnitModel, string> = {
  opus: "Opus · tank",
  sonnet: "Sonnet · infantry squad",
  haiku: "Haiku · scout",
};
