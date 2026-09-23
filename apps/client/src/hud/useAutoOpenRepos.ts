import { useEffect, useRef } from "react";
import { useStore } from "../store.ts";

/** On first connect with nothing monitored, open the Repos sheet so there's an obvious first step. */
export function useAutoOpenRepos(): void {
  const connection = useStore((s) => s.connection);
  const repoCount = useStore((s) => Object.keys(s.war.repos).length);
  const done = useRef(false);
  useEffect(() => {
    if (done.current || connection !== "open") return;
    done.current = true;
    if (repoCount === 0) useStore.getState().openRepos();
  }, [connection, repoCount]);
}
