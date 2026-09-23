import { describe, expect, it } from "vitest";
import type { LogEntry, ServerEvent } from "@ww/shared";
import { Db } from "../db.ts";
import { assistant, init, messageStart, result, textDelta } from "./fixtures.ts";
import { UnitLog } from "./log.ts";
import { UnitManager, type QueryFn } from "./manager.ts";
import { PermissionQueue } from "./permissions.ts";
import { storeWithFront, tick } from "./testkit.ts";

describe("UnitLog", () => {
  it("records a full turn: order, streamed text, tool, permission, decision, result", async () => {
    const store = storeWithFront();
    const db = new Db(":memory:");
    const transcript = new UnitLog(store, db);
    const permissions = new PermissionQueue(store);
    const live: LogEntry[] = [];
    store.subscribe((ev: ServerEvent) => ev.type === "unit.entry" && live.push(ev.entry));

    const queryFn: QueryFn = ({ options }) =>
      (async function* () {
        yield init("s1");
        yield messageStart("m1");
        yield textDelta("Looking ");
        yield textDelta("around.");
        yield assistant("m2", [{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
        await options.canUseTool!("Bash", { command: "ls" }, { signal: new AbortController().signal, toolUseID: "t" } as never);
        yield messageStart("m3");
        yield textDelta("Done.");
        yield result();
      })();
    const units = new UnitManager({ store, db, permissions, queryFn, changedFiles: async () => 2, transcript });
    const u = units.create("f1", "sonnet", "Squad");
    units.order(u.id, "list files");
    await expect.poll(() => Object.keys(store.state.permissions).length).toBe(1);
    permissions.resolve(Object.keys(store.state.permissions)[0]!, true);
    await expect.poll(() => store.state.units[u.id]?.status).toBe("idle");
    await tick();

    const h = transcript.history(u.id);
    expect(h.map((e) => [e.kind, e.text])).toEqual([
      ["order", "list files"],
      ["assistant", "Looking around."],
      ["tool", "ls"],
      ["permission", "ls"],
      ["decision", "Allowed Bash"],
      ["assistant", "Done."],
      ["result", expect.stringMatching(/^Done · \d+s · \$0\.01 · 2 files changed$/)],
    ]);
    // Clients got every line live; assistant lines start empty and fill from unit.text deltas.
    expect(live.map((e) => e.kind)).toEqual(h.map((e) => e.kind));
    expect(live.find((e) => e.kind === "assistant")?.text).toBe("");
  });
});
