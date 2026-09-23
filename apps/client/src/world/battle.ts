import type * as THREE from "three";
import type { Mover, NavGrid, Point } from "./nav.ts";

/** A friendly unit as the battle sees it, in island-local coordinates. */
export interface Combatant {
  /** Live position (shared with the unit's mover, so separation can nudge it). */
  pos: Point;
  /** Body radius: vehicles take more room than soldiers. */
  r: number;
  /** Its formation spot, so other units pick different ones. */
  home: Point | null;
  y: number;
  /** Road curve parameter nearest the unit. */
  s: number;
  working: boolean;
}

export type EnemyState = "arriving" | "fighting" | "dying" | "leaving";

export interface Enemy {
  id: number;
  mover: Mover;
  y: number;
  /** Where it holds position; it moves between spots near this. */
  post: Point;
  /** Where it came from and retreats to. */
  home: Point;
  state: EnemyState;
  /** Seconds in the current state. */
  t: number;
  nextShot: number;
  nextMove: number;
  killAt: number | null;
  object: THREE.Object3D;
}

const alive = (e: Enemy) => e.state === "arriving" || e.state === "fighting";
const dist2 = (a: Point, b: Point) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

/**
 * Shared, mutable battlefield for one island: its walkable grid, where the
 * units are, and the enemy force. Each side picks targets from the other.
 * Lives outside React; updated every frame.
 */
export class Battle {
  readonly units = new Map<string, Combatant>();
  enemies: Enemy[] = [];
  nav: NavGrid | null = null;

  get engaged(): boolean {
    for (const u of this.units.values()) if (u.working) return true;
    return false;
  }

  workingCount(): number {
    let n = 0;
    for (const u of this.units.values()) if (u.working) n++;
    return n;
  }

  /** The working unit furthest along the road. */
  lead(): Combatant | null {
    let best: Combatant | null = null;
    for (const u of this.units.values()) if (u.working && (!best || u.s > best.s)) best = u;
    return best;
  }

  aliveEnemies(): Enemy[] {
    return this.enemies.filter(alive);
  }

  nearestEnemy(p: Point): Enemy | null {
    let best: Enemy | null = null;
    let d = Infinity;
    for (const e of this.enemies) {
      if (!alive(e) || e.killAt !== null) continue;
      const dd = dist2(e.mover.pos, p);
      if (dd < d) {
        d = dd;
        best = e;
      }
    }
    return best;
  }

  nearestUnit(p: Point): Combatant | null {
    let best: Combatant | null = null;
    let d = Infinity;
    for (const u of this.units.values()) {
      const dd = dist2(u.pos, p) - (u.working ? 1000 : 0);
      if (dd < d) {
        d = dd;
        best = u;
      }
    }
    return best;
  }

  /** Distance from `p` to the closest friendly unit. */
  distToUnits(p: Point): number {
    let d = Infinity;
    for (const u of this.units.values()) d = Math.min(d, Math.sqrt(dist2(u.pos, p)));
    return d;
  }

  /** Distance from `p` to the closest living enemy. */
  distToEnemies(p: Point): number {
    let d = Infinity;
    for (const e of this.enemies) if (alive(e)) d = Math.min(d, Math.sqrt(dist2(e.mover.pos, p)));
    return d;
  }

  /** True when `p` is at least `r` + their radius from every other unit's formation spot. */
  homeIsFree(unitId: string, p: Point, r: number): boolean {
    for (const [id, u] of this.units) {
      if (id === unitId || !u.home) continue;
      if (Math.sqrt(dist2(u.home, p)) < r + u.r) return false;
    }
    return true;
  }

  /** Marks an enemy to fall when the tracer aimed at it lands. */
  kill(enemy: Enemy, at: number): void {
    if (alive(enemy) && enemy.killAt === null) enemy.killAt = at;
  }
}

/** Shortest-path interpolation between two yaw angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

/** Yaw that points a model (facing -z) along (dx, dz). */
export const headingTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);
