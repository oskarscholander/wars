/** Half extents of one island's footprint, in world units. */
export const ISLAND_HALF = { x: 11, z: 14 } as const;

/**
 * Island positions, one group per repo. Landscape: each repo is a row of islands
 * side by side. Portrait: everything stacks, with a wider gap between repos.
 * Islands are gently staggered like the prototype.
 */
export function islandPositions(groups: number[], portrait: boolean): [number, number][] {
  const out: [number, number][] = [];
  if (portrait) {
    const total = groups.reduce((a, b) => a + b, 0);
    const gaps = Math.max(0, groups.filter((g) => g > 0).length - 1);
    let z = -((total - 1) * 31 + gaps * 10) / 2;
    groups.forEach((count) => {
      for (let i = 0; i < count; i++, z += 31) out.push([out.length % 2 ? 3 : -3, z]);
      if (count) z += 10;
    });
    return out;
  }
  const rows = groups.filter((g) => g > 0).length;
  let row = 0;
  for (const count of groups) {
    if (!count) continue;
    const mid = (count - 1) / 2;
    const z = (row - (rows - 1) / 2) * 40;
    for (let i = 0; i < count; i++) out.push([(i - mid) * 25, z + (i % 2 ? -4 : 3)]);
    row++;
  }
  return out;
}
