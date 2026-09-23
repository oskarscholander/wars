import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { describe, expect, it } from "vitest";
import { Db } from "../db.ts";
import { Store } from "../store.ts";
import { assistant, init, messageStart, result, textDelta } from "./fixtures.ts";
import { UnitManager, type QueryFn } from "./manager.ts";
import { PermissionQueue } from "./permissions.ts";
import { storeWithFront, testFront, tick } from "./testkit.ts";

interface Call {
  prompt: string;
  options: Options;
}

/** A fake query() that replays a script per call and records its options. */
function fakeQuery(scripts: ((opts: Options) => AsyncIterable<SDKMessage>)[]) {
  const calls: Call[] = [];
  const fn: QueryFn = ({ prompt, options }) => {
    calls.push({ prompt, options });
    const script = scripts.shift();
    if (!script) throw new Error("no script left");
    return script(options);
  };
  return { fn, calls };
}

const reply = (session: string, id: string, text: string) =>
  async function* (): AsyncIterable<SDKMessage> {
    yield init(session);
    yield messageStart(id);
    yield textDelta(text);
    yield result();
  };

function setup(fn: QueryFn, store = storeWithFront(), db = new Db(":memory:")) {
  const permissions = new PermissionQueue(store);
  const units = new UnitManager({ store, db, permissions, queryFn: fn, changedFiles: async () => 3 });
  return { store, db, permissions, units };
}

const idle = (store: Store, id: string) => expect.poll(() => store.state.units[id]?.status).toBe("idle");

describe("UnitManager", () => {
  it("runs an order, streams text and records the session and usage", async () => {
    const q = fakeQuery([reply("s1", "m1", "On it.")]);
    const { store, units } = setup(q.fn);
    const u = units.create("f1", "haiku", "Scout");
    units.order(u.id, "look around");
    await idle(store, u.id);

    const after = store.state.units[u.id]!;
    expect(after).toMatchObject({ sessionId: "s1", reply: "On it.", turns: 1, filesChanged: 3, inputTokens: 100, outputTokens: 5 });
    expect(q.calls[0]?.options).toMatchObject({ cwd: "/tmp/f1", model: "haiku", includePartialMessages: true });
    expect(q.calls[0]?.options.resume).toBeUndefined();
  });

  it("resumes the stored session on later orders, also after a restart", async () => {
    const db = new Db(":memory:");
    const q1 = fakeQuery([reply("s1", "m1", "First.")]);
    const first = setup(q1.fn, storeWithFront(), db);
    const u = first.units.create("f1", "sonnet", "Squad");
    first.units.order(u.id, "one");
    await idle(first.store, u.id);

    // New store and manager over the same database: a daemon restart.
    const q2 = fakeQuery([reply("s1", "m2", "Second.")]);
    const second = setup(q2.fn, storeWithFront(), db);
    expect(second.store.state.units[u.id]).toMatchObject({ reply: "First.", sessionId: "s1", status: "idle" });
    second.units.order(u.id, "two");
    await idle(second.store, u.id);
    expect(q2.calls[0]?.options.resume).toBe("s1");
    expect(second.store.state.units[u.id]).toMatchObject({ reply: "Second.", turns: 2 });
  });

  it("queues orders sent while working and runs them in order", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const q = fakeQuery([
      async function* () {
        yield init("s1");
        await gate;
        yield result();
      },
      reply("s1", "m2", "Two done."),
    ]);
    const { store, units } = setup(q.fn);
    const u = units.create("f1", "sonnet", "Squad");
    units.order(u.id, "one");
    await tick();
    units.order(u.id, "two");
    expect(store.state.units[u.id]).toMatchObject({ status: "working", queuedOrders: 1 });
    release();
    await idle(store, u.id);
    expect(q.calls.map((c) => c.prompt)).toEqual(["one", "two"]);
    expect(store.state.units[u.id]).toMatchObject({ reply: "Two done.", queuedOrders: 0, turns: 2 });
  });

  it("routes canUseTool through the permission queue", async () => {
    let decision: unknown;
    const q = fakeQuery([
      async function* (opts) {
        yield init("s1");
        yield assistant("m1", [{ type: "tool_use", name: "Bash", input: { command: "ls" } }]);
        decision = await opts.canUseTool!("Bash", { command: "ls" }, { signal: new AbortController().signal, toolUseID: "t1" } as never);
        yield result();
      },
    ]);
    const { store, units, permissions } = setup(q.fn);
    const u = units.create("f1", "opus", "Tank");
    units.order(u.id, "list files");
    await expect.poll(() => store.state.units[u.id]?.status).toBe("waiting");
    const [req] = Object.values(store.state.permissions);
    expect(req).toMatchObject({ unitId: u.id, tool: "Bash", summary: "ls" });
    permissions.resolve(req!.id, false, "nope");
    await idle(store, u.id);
    expect(decision).toEqual({ behavior: "deny", message: "nope" });
  });

  it("surfaces errors in the bubble and marks the unit", async () => {
    const q = fakeQuery([
      async function* () {
        yield init("s1");
        throw new Error("boom");
      },
    ]);
    const { store, units } = setup(q.fn);
    const u = units.create("f1", "sonnet", "Squad");
    units.order(u.id, "go");
    await expect.poll(() => store.state.units[u.id]?.status).toBe("error");
    expect(store.state.units[u.id]?.reply).toBe("Error: boom");
  });

  it("starts fresh once when the stored session cannot be found", async () => {
    const db = new Db(":memory:");
    const store = storeWithFront();
    const q = fakeQuery([
      // eslint-disable-next-line require-yield -- fails before producing anything, like the real SDK
      async function* () {
        throw new Error("No conversation found with session ID: s-old");
      },
      reply("s-new", "m1", "Fresh start."),
    ]);
    db.saveUnit({ id: "u1", frontId: "f1", name: "Old", model: "sonnet", sessionId: "s-old", turns: 4, filesChanged: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, replyId: null, reply: "", createdAt: 1 });
    const { units } = setup(q.fn, store, db);
    units.order("u1", "hello");
    await idle(store, "u1");
    expect(q.calls[1]?.options.resume).toBeUndefined();
    expect(store.state.units.u1).toMatchObject({ sessionId: "s-new", reply: "Fresh start." });
  });

  it("loads stored units when their front appears later", async () => {
    const db = new Db(":memory:");
    db.saveUnit({ id: "u1", frontId: "f2", name: "Later", model: "haiku", sessionId: null, turns: 0, filesChanged: 0, inputTokens: 0, outputTokens: 0, costUsd: 0, replyId: null, reply: "", createdAt: 1 });
    const { store } = setup(fakeQuery([]).fn, storeWithFront("f1"), db);
    expect(store.state.units.u1).toBeUndefined();
    store.emit({ type: "front.upserted", front: testFront("f2") });
    await tick();
    expect(store.state.units.u1?.name).toBe("Later");
  });
});
