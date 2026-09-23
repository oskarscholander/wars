/** Half extents of one island's footprint, in world units. */
export const ISLAND_HALF = { x: 11, z: 14 } as const;

/** Islands side by side on landscape, stacked on portrait, gently staggered like the prototype. */
export function islandPositions(count: number, portrait: boolean): [number, number][] {
  const mid = (count - 1) / 2;
  return Array.from({ length: count }, (_, i) =>
    portrait ? [i % 2 ? 3 : -3, (i - mid) * 31] : [(i - mid) * 25, i % 2 ? -4 : 3],
  );
}
