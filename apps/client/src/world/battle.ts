import type * as THREE from "three";

/** A friendly unit as the battle sees it, in island-local coordinates. */
export interface Combatant {
  x: number;
  z: number;
  y: number;
  /** Road curve parameter. */
  s: number;
  working: boolean;
}

export type EnemyState = "arriving" | "fighting" | "dying" | "leaving";

export interface Enemy {
  id: number;
  s: number;
  lane: number;
  x: number;
  y: number;
  z: number;
  /** Where it holds position; it strafes around this. */
  post: { s: number; lane: number };
  offset: { s: number; lane: number; ts: number; tl: number };
  state: EnemyState;
  /** Seconds in the current state. */
  t: number;
  nextShot: number;
  nextMove: number;
  killAt: number | null;
  object: THREE.Object3D;
}

const alive = (e: Enemy) => e.state === "arriving" || e.state === "fighting";

/**
 * Shared, mutable battlefield for one island: units publish where they are,
 * the enemy force publishes its soldiers, and each side picks targets from
 * the other. Lives outside React; updated every frame.
 */
export class Battle {
  readonly units = new Map<string, Combatant>();
  enemies: Enemy[] = [];

  get engaged(): boolean {
    for (const u of this.units.values()) if (u.working) return true;
    return false;
  }

  workingCount(): number {
    let n = 0;
    for (const u of this.units.values()) if (u.working) n++;
    return n;
  }

  /** Furthest road position of any working unit. */
  leadS(): number {
    let s = 0;
    for (const u of this.units.values()) if (u.working) s = Math.max(s, u.s);
    return s;
  }

  aliveEnemies(): Enemy[] {
    return this.enemies.filter(alive);
  }

  nearestEnemy(x: number, z: number): Enemy | null {
    let best: Enemy | null = null;
    let d = Infinity;
    for (const e of this.enemies) {
      if (!alive(e) || e.killAt !== null) continue;
      const dd = (e.x - x) ** 2 + (e.z - z) ** 2;
      if (dd < d) {
        d = dd;
        best = e;
      }
    }
    return best;
  }

  nearestUnit(x: number, z: number): Combatant | null {
    let best: Combatant | null = null;
    let d = Infinity;
    for (const u of this.units.values()) {
      const dd = (u.x - x) ** 2 + (u.z - z) ** 2 - (u.working ? 1000 : 0);
      if (dd < d) {
        d = dd;
        best = u;
      }
    }
    return best;
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
