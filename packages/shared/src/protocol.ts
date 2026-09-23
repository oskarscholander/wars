import type { DiffFile, Front, LogEntry, PermissionMode, PermissionRequest, Repo, RepoSuggestion, TestsState, Unit, UnitModel, UnitStatus, WarState } from "./types.ts";

/** Daemon → client. Every message is `{ type, ...payload }`. */
export type ServerEvent =
  | { type: "state.snapshot"; state: WarState }
  | { type: "repo.upserted"; repo: Repo }
  | { type: "repo.removed"; repoId: string }
  /** Reply to `repo.suggest`, sent only to the asking client. Not state. */
  | { type: "repo.suggestions"; suggestions: RepoSuggestion[] }
  | { type: "front.upserted"; front: Front }
  | { type: "front.removed"; frontId: string }
  | { type: "unit.upserted"; unit: Unit }
  | { type: "unit.removed"; unitId: string }
  | { type: "unit.status"; unitId: string; status: UnitStatus }
  | { type: "unit.text"; unitId: string; messageId: string; delta: string }
  | { type: "unit.tool"; unitId: string; tool: string; summary: string }
  | { type: "permission.request"; request: PermissionRequest }
  | { type: "permission.resolved"; id: string; allow: boolean }
  | { type: "diff.updated"; frontId: string; files: DiffFile[] }
  | { type: "tests.result"; frontId: string; tests: TestsState }
  | { type: "pr.opened"; frontId: string; number: number; url: string }
  | { type: "pr.merged"; frontId: string }
  | {
      type: "error";
      message: string;
      command?: ClientCommand["type"];
      /** Machine-readable reason the client can act on, e.g. offer a forced delete. */
      code?: "dirty" | "locked";
      frontId?: string;
    }
  /** A new line in a unit's terminal. Assistant lines then grow via `unit.text` deltas with the same messageId. */
  | { type: "unit.entry"; entry: LogEntry }
  /** Reply to `unit.history`, sent only to the asking client: the latest entries, oldest first. */
  | { type: "unit.history"; unitId: string; entries: LogEntry[] }
  /** Reply to a successful `front.delete`, sent only to the asking client. */
  | { type: "front.deleted"; frontId: string; branch: string | null; branchDeleted: boolean; branchNote?: string };

/** Client → daemon. */
export type ClientCommand =
  | { type: "repo.add"; path: string }
  | { type: "repo.remove"; repoId: string }
  | { type: "repo.update"; repoId: string; testCommand: string[] }
  | { type: "repo.suggest" }
  | { type: "front.create"; repoId: string; branch: string }
  /** Removes the worktree. `force` also discards uncommitted changes; `deleteBranch` safely deletes a merged branch. */
  | { type: "front.delete"; frontId: string; force?: boolean; deleteBranch?: boolean }
  | { type: "unit.create"; frontId: string; model: UnitModel; name: string; permissionMode?: PermissionMode }
  | { type: "unit.order"; unitId: string; text: string }
  | { type: "unit.update"; unitId: string; permissionMode: PermissionMode }
  | { type: "unit.history"; unitId: string }
  | { type: "permission.resolve"; id: string; allow: boolean; message?: string }
  | { type: "diff.request"; frontId: string }
  | { type: "tests.run"; frontId: string }
  | { type: "pr.open"; frontId: string }
  | { type: "pr.merge"; frontId: string };

export type ServerEventType = ServerEvent["type"];
export type ClientCommandType = ClientCommand["type"];
