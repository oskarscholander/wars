import type { ClientCommand } from "@ww/shared";
import type { Config } from "./config.ts";
import type { Diffs } from "./diffs.ts";
import type { Discovery } from "./discovery.ts";
import { createWorktree, WorktreeError } from "./git/createWorktree.ts";
import type { Store } from "./store.ts";
import { ShippingError, type Shipping } from "./shipping/shipping.ts";
import { UnitError, type UnitManager } from "./units/manager.ts";
import type { PermissionQueue } from "./units/permissions.ts";

export interface Deps {
  config: Config;
  store: Store;
  discovery: Discovery;
  units: UnitManager;
  permissions: PermissionQueue;
  diffs: Diffs;
  shipping: Shipping;
}

/** Thrown for failures the user should see verbatim. */
export class CommandError extends Error {}

export async function handleCommand(cmd: ClientCommand, deps: Deps): Promise<void> {
  try {
    await dispatch(cmd, deps);
  } catch (err) {
    if (err instanceof UnitError || err instanceof ShippingError) throw new CommandError(err.message);
    throw err;
  }
}

async function dispatch(cmd: ClientCommand, deps: Deps): Promise<void> {
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
    case "unit.create":
      deps.units.create(cmd.frontId, cmd.model, cmd.name);
      return;
    case "unit.order":
      deps.units.order(cmd.unitId, cmd.text);
      return;
    case "diff.request":
      if (!deps.store.state.fronts[cmd.frontId]) throw new CommandError("That front no longer exists");
      await deps.diffs.refresh(cmd.frontId);
      return;
    case "tests.run":
      await deps.shipping.runTests(cmd.frontId);
      return;
    case "pr.open":
      await deps.shipping.openPr(cmd.frontId);
      return;
    case "pr.merge":
      await deps.shipping.mergePr(cmd.frontId);
      return;
    case "permission.resolve":
      if (!deps.permissions.resolve(cmd.id, cmd.allow, cmd.message)) {
        throw new CommandError("That request was already answered");
      }
      return;
  }
}
