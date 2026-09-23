import { describe, expect, it } from "vitest";
import { Mover, NavGrid, separate, type Ground } from "./nav.ts";

// A round island of radius 10 with a lake of radius 3 in the middle.
const island: Ground = {
  height: (x, z) => {
    const r = Math.hypot(x, z);
    return r < 3 ? -1 : r < 10 ? 1 : -1;
  },
};

describe("NavGrid", () => {
  const nav = new NavGrid(island, 24, 24);

  it("marks sea and lake unwalkable", () => {
    expect(nav.walkable(6, 0)).toBe(true);
    expect(nav.walkable(0, 0)).toBe(false);
    expect(nav.walkable(11, 0)).toBe(false);
  });

  it("walks around the lake instead of through it", () => {
    const path = nav.findPath({ x: -6, z: 0 }, { x: 6, z: 0 });
    expect(path.length).toBeGreaterThan(1);
    let prev = { x: -6, z: 0 };
    for (const p of path) {
      expect(nav.lineOfSight(prev, p)).toBe(true);
      prev = p;
    }
    expect(path.at(-1)).toEqual({ x: 6, z: 0 });
  });

  it("goes straight when nothing is in the way", () => {
    expect(nav.findPath({ x: 5, z: -2 }, { x: 5, z: 2 })).toEqual([{ x: 5, z: 2 }]);
  });

  it("snaps targets in the water to the nearest land", () => {
    const path = nav.findPath({ x: 6, z: 0 }, { x: 15, z: 0 });
    const end = path.at(-1)!;
    expect(nav.walkable(end.x, end.z)).toBe(true);
    expect(end.x).toBeLessThan(10);
  });

  it("respects obstacles and dynamic blockers", () => {
    const blocked = new NavGrid(island, 24, 24, [{ x: 6, z: 0, r: 1 }]);
    expect(blocked.walkable(6, 0)).toBe(false);
    blocked.setDynamic("bunker", { x: 0, z: 6, r: 1.5 });
    expect(blocked.walkable(0, 6)).toBe(false);
    blocked.setDynamic("bunker", null);
    expect(blocked.walkable(0, 6)).toBe(true);
  });

  it("finds random spots only on land", () => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 50; i++) {
      const p = nav.randomNear({ x: 7, z: 0 }, 1, 8, rnd);
      if (p) expect(nav.walkable(p.x, p.z)).toBe(true);
    }
  });
});

describe("Mover and separation", () => {
  const nav = new NavGrid(island, 24, 24);

  it("moves along a path at its speed", () => {
    const m = new Mover({ x: 5, z: -2 }, 2);
    expect(m.goTo(nav, { x: 5, z: 2 })).toBe(true);
    m.step(1);
    expect(m.pos.z).toBeCloseTo(0);
    m.step(5);
    expect(m.pos).toEqual({ x: 5, z: 2 });
    expect(m.moving).toBe(false);
  });

  it("keeps big bodies further apart than small ones", () => {
    const tank = { x: 5, z: 0 };
    const scout = { x: 5.5, z: 0 };
    separate(nav, [
      { pos: tank, r: 1.25 },
      { pos: scout, r: 0.95 },
    ]);
    expect(Math.hypot(scout.x - tank.x, scout.z - tank.z)).toBeCloseTo(2.2);
  });

  it("pushes overlapping agents apart without leaving land", () => {
    const a = { x: 6, z: 0 };
    const b = { x: 6.2, z: 0 };
    separate(nav, [
      { pos: a, r: 0.5 },
      { pos: b, r: 0.5 },
    ]);
    expect(Math.hypot(b.x - a.x, b.z - a.z)).toBeCloseTo(1);
    expect(nav.walkable(a.x, a.z) && nav.walkable(b.x, b.z)).toBe(true);
  });
});
