import { useMemo } from "react";
import type { Front, WarState } from "@ww/shared";
import { frontTitle, sortedFronts, useStore } from "../store.ts";
import { formatAge, useNow } from "../world/age.ts";

const needsYou = (war: WarState, frontId?: string) =>
  Object.values(war.permissions).filter((p) => !frontId || p.frontId === frontId).length;

function frontSubtitle(war: WarState, f: Front): { text: string; tone?: "alert" | "won" } {
  if (f.pr?.state === "merged") return { text: "Won", tone: "won" };
  const waiting = needsYou(war, f.id);
  if (waiting) return { text: `${waiting} need${waiting > 1 ? "" : "s"} you`, tone: "alert" };
  const units = Object.values(war.units).filter((u) => u.frontId === f.id).length;
  const parts = [units ? `${units} unit${units > 1 ? "s" : ""}` : "No units"];
  if (f.pr?.state === "open") parts.push(`PR #${f.pr.number}`);
  if (f.tests.status === "failed") parts.push("tests failing");
  if (f.tests.status === "running") parts.push("testing…");
  return { text: parts.join(" · ") };
}

export function TopBar() {
  const war = useStore((s) => s.war);
  const connection = useStore((s) => s.connection);
  const selectedFrontId = useStore((s) => s.selectedFrontId);
  const selectFront = useStore((s) => s.selectFront);
  const openRepos = useStore((s) => s.openRepos);
  const repoCount = Object.keys(war.repos).length;
  const fronts = useMemo(() => sortedFronts(war), [war]);
  const waitingAll = needsYou(war);
  const now = useNow(60_000);

  const allSub =
    connection !== "open"
      ? { text: connection === "connecting" ? "Connecting…" : "Daemon offline", tone: "alert" as const }
      : waitingAll
        ? { text: `${waitingAll} need${waitingAll > 1 ? "" : "s"} you`, tone: "alert" as const }
        : { text: "All quiet" };

  return (
    <nav className="top" aria-label="Fronts">
      <button className="repos-chip" onClick={openRepos} disabled={connection !== "open"}>
        <b>Repos</b>
        <small>{repoCount ? `${repoCount} monitored` : "Pick repos"}</small>
      </button>
      <button aria-pressed={!selectedFrontId} onClick={() => selectFront(null)}>
        <b>All fronts</b>
        <small className={allSub.tone}>{allSub.text}</small>
      </button>
      {fronts.map((f) => {
        const sub = frontSubtitle(war, f);
        return (
          <button key={f.id} aria-pressed={f.id === selectedFrontId} onClick={() => selectFront(f.id)} title={[f.path, formatAge(f.createdAt, now)].filter(Boolean).join(" · ")}>
            <b>{frontTitle(war, f)}</b>
            <small className={sub.tone}>{sub.text}</small>
          </button>
        );
      })}
    </nav>
  );
}
