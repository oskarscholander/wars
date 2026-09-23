import type { ClientCommand } from "@ww/shared";
import type { Config } from "./config.ts";
import type { Discovery } from "./discovery.ts";
import { createWorktree, WorktreeError } from "./git/createWorktree.ts";
import type { Store } from "./store.ts";

export interface Deps {
  config: Config;
  store: Store;
  discovery: Discovery;
}

/** Thrown for failures the user should see verbatim. */
export class CommandError extends Error {}

const MILESTONE: Partial<Record<ClientCommand["type"], number>> = {
  "unit.create": 2,
  "unit.order": 2,
  "permission.resolve": 3,
  "diff.request": 4,
  "tests.run": 6,
  "pr.open": 6,
  "pr.merge": 6,
};

export async function handleCommand(cmd: ClientCommand, deps: Deps): Promise<void> {
  switch (cmd.type) {
    case "front.create":
      try {
        await createWorktree(deps.config.repoPath, cmd.branch);
      } catch (err) {
        if (err instanceof WorktreeError) throw new CommandError(err.message);
        throw err;
      }
      await deps.discovery.refresh();
      return;
    default:
      throw new CommandError(`${cmd.type} is not implemented yet (milestone ${MILESTONE[cmd.type] ?? "?"})`);
  }
}
