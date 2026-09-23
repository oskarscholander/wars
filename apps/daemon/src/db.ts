import { mkdirSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { PermissionMode, TestsState, Unit, UnitModel } from "@ww/shared";
import { wwHome } from "./token.ts";

/** Fields that survive a daemon restart. Status and queues are runtime-only. */
export type StoredUnit = Omit<Unit, "status" | "queuedOrders" | "activePermissionMode">;

interface Row {
  id: string;
  front_id: string;
  name: string;
  model: string;
  permission_mode: string;
  session_id: string | null;
  turns: number;
  files_changed: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  reply_id: string | null;
  reply: string;
  created_at: number;
}

const toUnit = (r: Row): StoredUnit => ({
  id: r.id,
  frontId: r.front_id,
  name: r.name,
  model: r.model as UnitModel,
  permissionMode: (r.permission_mode === "default" ? "default" : "auto") as PermissionMode,
  sessionId: r.session_id,
  turns: r.turns,
  filesChanged: r.files_changed,
  inputTokens: r.input_tokens,
  outputTokens: r.output_tokens,
  costUsd: r.cost_usd,
  replyId: r.reply_id,
  reply: r.reply,
  createdAt: r.created_at,
});

export class Db {
  #db: Database.Database;

  constructor(path = join(wwHome(), "state.sqlite")) {
    if (path !== ":memory:") mkdirSync(join(path, ".."), { recursive: true, mode: 0o700 });
    this.#db = new Database(path);
    this.#db.pragma("journal_mode = WAL");
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS units (
        id TEXT PRIMARY KEY,
        front_id TEXT NOT NULL,
        name TEXT NOT NULL,
        model TEXT NOT NULL,
        session_id TEXT,
        turns INTEGER NOT NULL DEFAULT 0,
        files_changed INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd REAL NOT NULL DEFAULT 0,
        reply_id TEXT,
        reply TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS units_front ON units(front_id);
      CREATE TABLE IF NOT EXISTS repos (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        test_command TEXT NOT NULL,
        added_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS front_tests (
        front_id TEXT PRIMARY KEY,
        tests TEXT NOT NULL
      );
    `);
    // Migration: units created before permission modes existed start in auto.
    const cols = (this.#db.prepare("PRAGMA table_info(units)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("permission_mode")) {
      this.#db.exec("ALTER TABLE units ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'auto'");
    }
  }

  unitsForFront(frontId: string): StoredUnit[] {
    return (this.#db.prepare("SELECT * FROM units WHERE front_id = ? ORDER BY created_at").all(frontId) as Row[]).map(
      toUnit,
    );
  }

  saveUnit(u: StoredUnit): void {
    this.#db
      .prepare(
        `INSERT INTO units (id, front_id, name, model, permission_mode, session_id, turns, files_changed, input_tokens, output_tokens, cost_usd, reply_id, reply, created_at)
         VALUES (@id, @frontId, @name, @model, @permissionMode, @sessionId, @turns, @filesChanged, @inputTokens, @outputTokens, @costUsd, @replyId, @reply, @createdAt)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name, model = excluded.model, permission_mode = excluded.permission_mode, session_id = excluded.session_id, turns = excluded.turns,
           files_changed = excluded.files_changed, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
           cost_usd = excluded.cost_usd, reply_id = excluded.reply_id, reply = excluded.reply`,
      )
      .run({
        id: u.id,
        frontId: u.frontId,
        name: u.name,
        model: u.model,
        permissionMode: u.permissionMode,
        sessionId: u.sessionId,
        turns: u.turns,
        filesChanged: u.filesChanged,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        costUsd: u.costUsd,
        replyId: u.replyId,
        reply: u.reply,
        createdAt: u.createdAt,
      });
  }

  /** Forgets a deleted worktree's units and test results. */
  forgetFront(frontId: string): void {
    this.#db.prepare("DELETE FROM units WHERE front_id = ?").run(frontId);
    this.#db.prepare("DELETE FROM front_tests WHERE front_id = ?").run(frontId);
  }

  listRepos(): { id: string; path: string; testCommand: string[] }[] {
    const rows = this.#db.prepare("SELECT id, path, test_command FROM repos ORDER BY added_at").all() as {
      id: string;
      path: string;
      test_command: string;
    }[];
    return rows.map((r) => ({ id: r.id, path: r.path, testCommand: JSON.parse(r.test_command) as string[] }));
  }

  saveRepo(repo: { id: string; path: string; testCommand: string[] }): void {
    this.#db
      .prepare(
        `INSERT INTO repos (id, path, test_command, added_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET test_command = excluded.test_command`,
      )
      .run(repo.id, repo.path, JSON.stringify(repo.testCommand), Date.now());
  }

  deleteRepo(id: string): void {
    this.#db.prepare("DELETE FROM repos WHERE id = ?").run(id);
  }

  saveTests(frontId: string, tests: TestsState): void {
    this.#db
      .prepare("INSERT INTO front_tests (front_id, tests) VALUES (?, ?) ON CONFLICT(front_id) DO UPDATE SET tests = excluded.tests")
      .run(frontId, JSON.stringify(tests));
  }

  loadTests(frontId: string): TestsState | null {
    const row = this.#db.prepare("SELECT tests FROM front_tests WHERE front_id = ?").get(frontId) as { tests: string } | undefined;
    return row ? (JSON.parse(row.tests) as TestsState) : null;
  }

  close(): void {
    this.#db.close();
  }
}
