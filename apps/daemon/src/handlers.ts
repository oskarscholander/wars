import type { ClientCommand, ServerEvent } from "@ww/shared";
import type { Config } from "./config.ts";
import type { Diffs } from "./diffs.ts";
import { createWorktree, WorktreeError } from "./git/createWorktree.ts";
import { RemoveError, removeWorktree } from "./git/removeWorktree.ts";
import type { Db } from "./db.ts";
import { RepoError, type RepoManager } from "./repos.ts";
import type { Store } from "./store.ts";
import { ShippingError, type Shipping } from "./shipping/shipping.ts";
import { UnitError, type UnitManager } from "./units/manager.ts";
import type { PermissionQueue } from "./units/permissions.ts";
import type { UnitLog } from "./units/log.ts";

export interface Deps {
  config: Config;
  store: Store;
  repos: RepoManager;
  units: UnitManager;
  permissions: PermissionQueue;
  diffs: Diffs;
  shipping: Shipping;
  db: Db;
  transcript: UnitLog;
}

/** Thrown for failures the user should see verbatim. */
export class CommandError extends Error {
  constructor(
    message: string,
    readonly code?: "dirty" | "locked",
    readonly frontId?: string,
  ) {
    super(message);
  }
}

/** Runs a command. May return an event meant only for the client that sent it. */
export async function handleCommand(cmd: ClientCommand, deps: Deps): Promise<ServerEvent | void> {
  try {
    return await dispatch(cmd, deps);
  } catch (err) {
    if (err instanceof UnitError || err instanceof ShippingError || err instanceof RepoError) {
      throw new CommandError(err.message);
    }
    throw err;
  }
}

async function dispatch(cmd: ClientCommand, deps: Deps): Promise<ServerEvent | void> {
  switch (cmd.type) {
    case "repo.add":
      await deps.repos.add(cmd.path);
      return;
    case "repo.remove":
      deps.repos.remove(cmd.repoId);
      return;
    case "repo.update":
      deps.repos.updateTestCommand(cmd.repoId, cmd.testCommand);
      return;
    case "repo.suggest":
      return { type: "repo.suggestions", suggestions: await deps.repos.suggest() };
    case "front.create": {
      const repo = deps.store.state.repos[cmd.repoId];
      if (!repo) throw new CommandError("Pick a repo first");
      try {
        await createWorktree(repo.path, cmd.branch);
      } catch (err) {
        if (err instanceof WorktreeError) throw new CommandError(err.message);
        throw err;
      }
      await deps.repos.refresh(repo.id);
      return;
    }
    case "front.delete": {
      const front = deps.store.state.fronts[cmd.frontId];
      const repo = front && deps.store.state.repos[front.repoId];
      if (!front || !repo) throw new CommandError("That worktree no longer exists");
      const busy = Object.values(deps.store.state.units).some(
        (u) => u.frontId === front.id && (u.status === "working" || u.status === "waiting"),
      );
      if (busy && !cmd.force) throw new CommandError("A unit is still working here. Delete anyway to stop it.", "dirty", front.id);
      deps.units.stopFront(front.id);
      let result;
      try {
        result = await removeWorktree(repo.path, front.path, {
          force: !!cmd.force,
          branch: front.branch,
          deleteBranch: !!cmd.deleteBranch,
        });
      } catch (err) {
        if (err instanceof RemoveError) throw new CommandError(err.message, err.code, front.id);
        throw err;
      }
      deps.db.forgetFront(front.id);
      await deps.repos.refresh(repo.id);
      return {
        type: "front.deleted",
        frontId: front.id,
        branch: front.branch,
        branchDeleted: result.branchDeleted,
        ...(result.branchNote ? { branchNote: result.branchNote } : {}),
      };
    }
    case "unit.create":
      deps.units.create(cmd.frontId, cmd.model, cmd.name, cmd.permissionMode);
      return;
    case "unit.history":
      if (!deps.store.state.units[cmd.unitId]) throw new CommandError("That unit no longer exists");
      return { type: "unit.history", unitId: cmd.unitId, entries: deps.transcript.history(cmd.unitId) };
    case "unit.update":
      deps.units.setPermissionMode(cmd.unitId, cmd.permissionMode);
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
