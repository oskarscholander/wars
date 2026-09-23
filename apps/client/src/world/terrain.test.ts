import { describe, expect, it } from "vitest";
import { IslandShape, TERRAIN } from "./terrain.ts";
import { scatterIslands } from "./layout.ts";

const seeds = Array.from({ length: 300 }, (_, i) => `feat/branch-${i}`);
const shapes = seeds.map((s) => new IslandShape(s));

describe("IslandShape", () => {
  it("keeps every road on land, HQ and flag on solid ground", () => {
    for (const sh of shapes) {
      for (let i = 0; i <= 60; i++) {
        const p = sh.roadPoint(i / 60);
        expect(sh.edge(p.x, p.z)).toBeGreaterThan(0.85);
      }
      expect(sh.roadPoint(0.02).y).toBeGreaterThan(0.15);
      expect(sh.roadPoint(0.97).y).toBeGreaterThan(0.15);
    }
  });

  it("fits inside the terrain square", () => {
    for (const sh of shapes) {
      for (const x of [-TERRAIN.width / 2, TERRAIN.width / 2]) for (let z = -TERRAIN.depth / 2; z <= TERRAIN.depth / 2; z += 1) expect(sh.edge(x, z)).toBeLessThan(0.02);
      for (const z of [-TERRAIN.depth / 2, TERRAIN.depth / 2]) for (let x = -TERRAIN.width / 2; x <= TERRAIN.width / 2; x += 1) expect(sh.edge(x, z)).toBeLessThan(0.02);
    }
  });

  it("is deterministic per seed and varied across seeds", () => {
    expect(new IslandShape("x").extent).toBe(new IslandShape("x").extent);
    const extents = shapes.map((s) => s.extent);
    expect(Math.max(...extents) - Math.min(...extents)).toBeGreaterThan(4);
    const styles = new Set(shapes.map((s) => s.style));
    expect(styles.size).toBe(3);
    // Land area differs a lot, not just the outline.
    const area = (sh: IslandShape) => {
      let n = 0;
      for (let x = -16; x < 16; x += 0.5) for (let z = -20; z < 20; z += 0.5) if (sh.edge(x, z) > 0.5) n++;
      return n * 0.25;
    };
    const areas = shapes.slice(0, 40).map(area);
    expect(Math.max(...areas) / Math.min(...areas)).toBeGreaterThan(1.6);
  });
});

describe("scatterIslands with real sizes", () => {
  it("never lets two islands' land overlap", () => {
    for (let n = 2; n <= 12; n++) {
      const ids = seeds.slice(n * 10, n * 10 + n);
      const radii = ids.map((id) => new IslandShape(id).extent);
      const places = scatterIslands([{ key: "r", ids, radii }], false);
      const all = [...places.values()];
      for (let a = 0; a < all.length; a++)
        for (let b = a + 1; b < all.length; b++) {
          const d = Math.hypot(all[a]!.x - all[b]!.x, all[a]!.z - all[b]!.z);
          expect(d).toBeGreaterThanOrEqual(all[a]!.r + all[b]!.r);
        }
    }
  });
});
