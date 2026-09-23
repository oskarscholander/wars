import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { Db } from "./db.ts";

describe("Db migrations", () => {
  it("adds permission_mode to an existing units table, defaulting to auto", async () => {
    const dir = await mkdtemp(join(tmpdir(), "ww-db-"));
    const path = join(dir, "state.sqlite");
    try {
      const old = new Database(path);
      old.exec(`CREATE TABLE units (id TEXT PRIMARY KEY, front_id TEXT NOT NULL, name TEXT NOT NULL, model TEXT NOT NULL,
        session_id TEXT, turns INTEGER NOT NULL DEFAULT 0, files_changed INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0,
        reply_id TEXT, reply TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`);
      old.prepare("INSERT INTO units (id, front_id, name, model, session_id, created_at) VALUES ('u1', 'f1', 'Old', 'opus', 's1', 1)").run();
      old.close();

      const db = new Db(path);
      expect(db.unitsForFront("f1")).toMatchObject([{ id: "u1", sessionId: "s1", permissionMode: "auto" }]);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
