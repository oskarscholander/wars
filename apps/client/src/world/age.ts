import { useEffect, useState } from "react";

const DAY = 86_400_000;

export interface Age {
  days: number;
  /** 0 fresh … 1 overgrown: more and bigger trees, road going green. Full at about two months. */
  growth: number;
  /** 0 clean … 1 littered: junk washes up after a couple of days, full at about three months. */
  rubbish: number;
}

const step = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 10) / 10;

/**
 * How weathered an island looks for a worktree created at `createdAt`.
 * Levels are quantised to tenths so geometry only rebuilds when it visibly changes.
 */
export function ageOf(createdAt: number | null, now: number): Age {
  if (createdAt === null) return { days: 0, growth: 0.2, rubbish: 0 };
  const days = Math.max(0, (now - createdAt) / DAY);
  return {
    days,
    growth: step(Math.log1p(days) / Math.log1p(60)),
    rubbish: step(Math.pow(Math.max(0, days - 2) / 88, 0.8)),
  };
}

export function formatAge(createdAt: number | null, now: number): string | null {
  if (createdAt === null) return null;
  const h = (now - createdAt) / 3_600_000;
  if (h < 1) return "new";
  if (h < 24) return `${Math.floor(h)} h old`;
  const d = h / 24;
  if (d < 60) return `${Math.floor(d)} d old`;
  return `${Math.floor(d / 30)} mo old`;
}

/** Current time, refreshed every few minutes: enough for ages measured in days. */
export function useNow(intervalMs = 5 * 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}
