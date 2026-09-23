export type UnitModel = "opus" | "sonnet" | "haiku";
export const UNIT_MODELS: readonly UnitModel[] = ["opus", "sonnet", "haiku"];

export type UnitStatus = "idle" | "working" | "waiting" | "error";

export interface TestsState {
  status: "unknown" | "running" | "passed" | "failed";
  passed: number;
  failed: number;
  outputTail: string;
}

export interface PrState {
  number: number;
  url: string;
  state: "open" | "merged" | "closed";
}

/** A repository the user chose to monitor. Its linked worktrees are islands. */
export interface Repo {
  /** Stable id derived from the main worktree path. */
  id: string;
  /** Main worktree path. */
  path: string;
  /** Folder name, for labels. */
  name: string;
  /** Argument array run by "Run tests" in any of its worktrees. */
  testCommand: string[];
}

/** A git repo found on disk that the user may want to monitor. */
export interface RepoSuggestion {
  path: string;
  name: string;
}

/** One linked git worktree of a monitored repo: an island. */
export interface Front {
  /** Stable id derived from the worktree path. */
  id: string;
  repoId: string;
  path: string;
  /** Short branch name, or null when HEAD is detached. */
  branch: string | null;
  head: string;
  locked: boolean;
  prunable: boolean;
  tests: TestsState;
  pr: PrState | null;
}

/** One Claude Code session in a worktree. */
export interface Unit {
  id: string;
  frontId: string;
  name: string;
  model: UnitModel;
  status: UnitStatus;
  sessionId: string | null;
  turns: number;
  filesChanged: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Orders waiting behind the active query. */
  queuedOrders: number;
  /** Id of the assistant message currently shown in the bubble. */
  replyId: string | null;
  reply: string;
  createdAt: number;
}

export interface PermissionRequest {
  id: string;
  unitId: string;
  frontId: string;
  tool: string;
  input: unknown;
  summary: string;
  createdAt: number;
}

export interface DiffLine {
  kind: "context" | "add" | "del";
  text: string;
  oldLine: number | null;
  newLine: number | null;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface DiffFile {
  path: string;
  oldPath: string | null;
  added: number;
  removed: number;
  binary: boolean;
  hunks: DiffHunk[];
}

export interface WarState {
  repos: Record<string, Repo>;
  fronts: Record<string, Front>;
  units: Record<string, Unit>;
  permissions: Record<string, PermissionRequest>;
  diffs: Record<string, DiffFile[]>;
}

export const emptyTests = (): TestsState => ({ status: "unknown", passed: 0, failed: 0, outputTail: "" });

export const emptyState = (): WarState => ({ repos: {}, fronts: {}, units: {}, permissions: {}, diffs: {} });
