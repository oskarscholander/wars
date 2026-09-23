import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";

/** After the first snapshot, if nothing is monitored, open the Repos sheet so there's an obvious first step. */
export function useAutoOpenRepos(): void {
  const synced = useStore((s) => s.synced);
  const repoCount = useStore((s) => Object.keys(s.war.repos).length);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !synced) return;
    done.current = true;
    if (repoCount === 0) useStore.getState().openRepos();
  }, [synced, repoCount]);
}
