/** Anything with a height field: the island shape, or a stand-in in tests. */
export interface Ground {
  height(x: number, z: number): number;
}

export interface Point {
  x: number;
  z: number;
}

export interface Obstacle extends Point {
  r: number;
}

/** Land below this height is beach at the waterline or sea: not walkable. */
export const WALKABLE_HEIGHT = 0.15;

/**
 * Walkable grid for one island: land above the waterline, minus obstacles
 * (trees, rocks, tent) and any dynamic blockers (a standing bunker). Paths are
 * A* on the 8-connected grid, then smoothed by line of sight so agents walk
 * straight where they can.
 */
export class NavGrid {
  readonly cell: number;
  readonly cols: number;
  readonly rows: number;
  readonly #x0: number;
  readonly #z0: number;
  readonly #static: Uint8Array;
  readonly #dynamic = new Map<string, Obstacle>();

  constructor(ground: Ground, width: number, depth: number, obstacles: Obstacle[] = [], cell = 0.5) {
    this.cell = cell;
    this.cols = Math.ceil(width / cell);
    this.rows = Math.ceil(depth / cell);
    this.#x0 = -width / 2;
    this.#z0 = -depth / 2;
    this.#static = new Uint8Array(this.cols * this.rows);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const { x, z } = this.center(c, r);
        let ok = ground.height(x, z) > WALKABLE_HEIGHT;
        if (ok) for (const o of obstacles) if ((o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r) ok = false;
        this.#static[r * this.cols + c] = ok ? 1 : 0;
      }
    }
  }

  center(c: number, r: number): Point {
    return { x: this.#x0 + (c + 0.5) * this.cell, z: this.#z0 + (r + 0.5) * this.cell };
  }

  #cellOf(x: number, z: number): [number, number] {
    return [Math.floor((x - this.#x0) / this.cell), Math.floor((z - this.#z0) / this.cell)];
  }

  /** Adds, moves or (with null) clears a blocker such as the bunker. */
  setDynamic(id: string, o: Obstacle | null): void {
    if (o) this.#dynamic.set(id, o);
    else this.#dynamic.delete(id);
  }

  #open(c: number, r: number): boolean {
    if (c < 0 || r < 0 || c >= this.cols || r >= this.rows || !this.#static[r * this.cols + c]) return false;
    if (!this.#dynamic.size) return true;
    const { x, z } = this.center(c, r);
    for (const o of this.#dynamic.values()) if ((o.x - x) ** 2 + (o.z - z) ** 2 < o.r * o.r) return false;
    return true;
  }

  walkable(x: number, z: number): boolean {
    const [c, r] = this.#cellOf(x, z);
    return this.#open(c, r);
  }

  /** Closest walkable cell centre within `maxR`, searching outward ring by ring. */
  nearestWalkable(p: Point, maxR = 12): Point | null {
    const [c0, r0] = this.#cellOf(p.x, p.z);
    if (this.#open(c0, r0)) return { x: p.x, z: p.z };
    const maxRing = Math.ceil(maxR / this.cell);
    for (let ring = 1; ring <= maxRing; ring++) {
      let best: Point | null = null;
      let bestD = Infinity;
      for (let dr = -ring; dr <= ring; dr++) {
        for (let dc = -ring; dc <= ring; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== ring || !this.#open(c0 + dc, r0 + dr)) continue;
          const q = this.center(c0 + dc, r0 + dr);
          const d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
          if (d < bestD) {
            bestD = d;
            best = q;
          }
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** True when the straight segment a→b stays on walkable ground. */
  lineOfSight(a: Point, b: Point): boolean {
    const d = Math.hypot(b.x - a.x, b.z - a.z);
    const steps = Math.max(1, Math.ceil(d / (this.cell * 0.4)));
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (!this.walkable(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)) return false;
    }
    return true;
  }

  /**
   * Walkable path from `from` to `to` (both snapped to walkable ground first),
   * excluding the start point. Empty when unreachable or already there.
   */
  findPath(from: Point, to: Point): Point[] {
    const start = this.nearestWalkable(from, 4);
    const goal = this.nearestWalkable(to, 12);
    if (!start || !goal) return [];
    if (this.lineOfSight(start, goal)) return [goal];

    const [sc, sr] = this.#cellOf(start.x, start.z);
    const [gc, gr] = this.#cellOf(goal.x, goal.z);
    const n = this.cols * this.rows;
    const g = new Float32Array(n).fill(Infinity);
    const came = new Int32Array(n).fill(-1);
    const closed = new Uint8Array(n);
    const open = new MinHeap();
    const idx = (c: number, r: number) => r * this.cols + c;
    const h = (c: number, r: number) => {
      const dx = Math.abs(c - gc);
      const dz = Math.abs(r - gr);
      return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
    };
    g[idx(sc, sr)] = 0;
    open.push(idx(sc, sr), h(sc, sr));
    const goalI = idx(gc, gr);

    while (open.size) {
      const cur = open.pop();
      if (cur === goalI) break;
      if (closed[cur]) continue;
      closed[cur] = 1;
      const c = cur % this.cols;
      const r = (cur - c) / this.cols;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (!dr && !dc) continue;
          const nc = c + dc;
          const nr = r + dr;
          if (!this.#open(nc, nr)) continue;
          // No corner cutting past blocked cells.
          if (dr && dc && (!this.#open(c + dc, r) || !this.#open(c, r + dr))) continue;
          const ni = idx(nc, nr);
          const cost = g[cur]! + (dr && dc ? Math.SQRT2 : 1);
          if (cost < g[ni]!) {
            g[ni] = cost;
            came[ni] = cur;
            open.push(ni, cost + h(nc, nr));
          }
        }
      }
    }
    if (came[goalI] === -1) return [];

    const cells: Point[] = [];
    for (let i = goalI; i !== -1 && i !== idx(sc, sr); i = came[i]!) {
      const c = i % this.cols;
      cells.push(this.center(c, (i - c) / this.cols));
    }
    cells.reverse();
    cells[cells.length - 1] = goal;
    return this.#smooth(start, cells);
  }

  /** String-pulling: skip every waypoint the agent can see past. */
  #smooth(start: Point, cells: Point[]): Point[] {
    const out: Point[] = [];
    let anchor = start;
    let i = 0;
    while (i < cells.length) {
      let j = cells.length - 1;
      while (j > i && !this.lineOfSight(anchor, cells[j]!)) j--;
      out.push(cells[j]!);
      anchor = cells[j]!;
      i = j + 1;
    }
    return out;
  }

  /**
   * A random walkable spot between `rMin` and `rMax` from `around` that passes
   * `accept`. Tries up to `tries` times; null when none is found.
   */
  randomNear(around: Point, rMin: number, rMax: number, rnd: () => number, accept: (p: Point) => boolean = () => true, tries = 40): Point | null {
    for (let i = 0; i < tries; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rMin + rnd() * (rMax - rMin);
      const p = { x: around.x + Math.cos(a) * d, z: around.z + Math.sin(a) * d };
      if (this.walkable(p.x, p.z) && accept(p)) return p;
    }
    return null;
  }
}

/** Binary min-heap of (index, priority), enough for grid A*. */
class MinHeap {
  #items: number[] = [];
  #prio: number[] = [];

  get size(): number {
    return this.#items.length;
  }

  push(item: number, p: number): void {
    this.#items.push(item);
    this.#prio.push(p);
    let i = this.#items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.#prio[parent]! <= this.#prio[i]!) break;
      this.#swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.#items[0]!;
    const lastItem = this.#items.pop()!;
    const lastPrio = this.#prio.pop()!;
    if (this.#items.length) {
      this.#items[0] = lastItem;
      this.#prio[0] = lastPrio;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < this.#items.length && this.#prio[l]! < this.#prio[m]!) m = l;
        if (r < this.#items.length && this.#prio[r]! < this.#prio[m]!) m = r;
        if (m === i) break;
        this.#swap(i, m);
        i = m;
      }
    }
    return top;
  }

  #swap(a: number, b: number): void {
    [this.#items[a], this.#items[b]] = [this.#items[b]!, this.#items[a]!];
    [this.#prio[a], this.#prio[b]] = [this.#prio[b]!, this.#prio[a]!];
  }
}

/**
 * Walks an agent along a path at a fixed speed. Position is mutated in place;
 * `heading` follows the direction of travel.
 */
export class Mover {
  path: Point[] = [];
  moving = false;

  constructor(
    public pos: Point,
    public speed: number,
  ) {}

  goTo(nav: NavGrid, to: Point): boolean {
    this.path = nav.findPath(this.pos, to);
    return this.path.length > 0;
  }

  /** Advances along the path. Returns the direction moved this step (zero when arrived). */
  step(dt: number): Point {
    let budget = this.speed * dt;
    const start = { ...this.pos };
    while (budget > 0 && this.path.length) {
      const next = this.path[0]!;
      const dx = next.x - this.pos.x;
      const dz = next.z - this.pos.z;
      const d = Math.hypot(dx, dz);
      if (d <= budget) {
        this.pos.x = next.x;
        this.pos.z = next.z;
        this.path.shift();
        budget -= d;
      } else {
        this.pos.x += (dx / d) * budget;
        this.pos.z += (dz / d) * budget;
        budget = 0;
      }
    }
    this.moving = this.path.length > 0;
    return { x: this.pos.x - start.x, z: this.pos.z - start.z };
  }
}

/**
 * Pushes agents apart when they get closer than `minDist`, but never onto
 * unwalkable ground. Cheap O(n²); islands hold a dozen agents at most.
 */
export function separate(nav: NavGrid, agents: Point[], minDist = 1.1): void {
  for (let i = 0; i < agents.length; i++) {
    for (let j = i + 1; j < agents.length; j++) {
      const a = agents[i]!;
      const b = agents[j]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (d >= minDist) continue;
      const push = (minDist - d) / 2;
      const ux = dx / d;
      const uz = dz / d;
      if (nav.walkable(a.x - ux * push, a.z - uz * push)) {
        a.x -= ux * push;
        a.z -= uz * push;
      }
      if (nav.walkable(b.x + ux * push, b.z + uz * push)) {
        b.x += ux * push;
        b.z += uz * push;
      }
    }
  }
}
