import { describe, expect, it } from "vitest";
import { PermissionQueue } from "./permissions.ts";
import { storeWithFront } from "./testkit.ts";
import { Db } from "../db.ts";
import { UnitManager } from "./manager.ts";

function setup() {
  const store = storeWithFront("f1", "f2");
  const permissions = new PermissionQueue(store);
  const units = new UnitManager({
    store,
    db: new Db(":memory:"),
    permissions,
    queryFn: () => (async function* () {})(),
    changedFiles: async () => 0,
  });
  const a = units.create("f1", "sonnet", "A");
  const b = units.create("f2", "opus", "B");
  return { store, permissions, a, b };
}

describe("PermissionQueue", () => {
  it("auto-allows read-only tools without asking", async () => {
    const { store, permissions, a } = setup();
    await expect(permissions.request(a.id, "Grep", { pattern: "x" })).resolves.toEqual({ allow: true });
    expect(store.state.permissions).toEqual({});
  });

  it("queues requests from several units and resolves each independently", async () => {
    const { store, permissions, a, b } = setup();
    const pa = permissions.request(a.id, "Bash", { command: "rm -rf build" });
    const pb = permissions.request(b.id, "Edit", { file_path: "src/x.ts" });

    const reqs = Object.values(store.state.permissions);
    expect(reqs.map((r) => r.summary).sort()).toEqual(["rm -rf build", "src/x.ts"]);
    expect(store.state.units[a.id]?.status).toBe("waiting");
    expect(store.state.units[b.id]?.status).toBe("waiting");

    const ra = reqs.find((r) => r.unitId === a.id)!;
    const rb = reqs.find((r) => r.unitId === b.id)!;
    expect(ra.frontId).toBe("f1");

    expect(permissions.resolve(rb.id, false, "not that file")).toBe(true);
    await expect(pb).resolves.toEqual({ allow: false, message: "not that file" });
    expect(store.state.units[b.id]?.status).toBe("working");
    expect(store.state.units[a.id]?.status).toBe("waiting");

    permissions.resolve(ra.id, true);
    await expect(pa).resolves.toEqual({ allow: true });
    expect(store.state.permissions).toEqual({});
  });

  it("rejects answering the same request twice", async () => {
    const { store, permissions, a } = setup();
    void permissions.request(a.id, "Bash", { command: "ls" });
    const [r] = Object.values(store.state.permissions);
    expect(permissions.resolve(r!.id, true)).toBe(true);
    expect(permissions.resolve(r!.id, true)).toBe(false);
  });

  it("denies and clears pending requests when aborted", async () => {
    const { store, permissions, a } = setup();
    const ac = new AbortController();
    const p = permissions.request(a.id, "Bash", { command: "ls" }, ac.signal);
    ac.abort();
    await expect(p).resolves.toMatchObject({ allow: false });
    expect(store.state.permissions).toEqual({});
  });

  it("stays waiting until the unit's last request is answered", async () => {
    const { store, permissions, a } = setup();
    void permissions.request(a.id, "Bash", { command: "one" });
    void permissions.request(a.id, "Bash", { command: "two" });
    const [r1] = Object.values(store.state.permissions);
    permissions.resolve(r1!.id, true);
    expect(store.state.units[a.id]?.status).toBe("waiting");
  });
});
