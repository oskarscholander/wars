import { emptyTests, type Front } from "@ww/shared";
import { Store } from "../store.ts";

export const TEST_REPO = { id: "r", path: "/tmp/repo", name: "repo", testCommand: ["pnpm", "test"] };

export const testFront = (id = "f1"): Front => ({
  id,
  repoId: "r",
  path: `/tmp/${id}`,
  branch: `feat/${id}`,
  head: "abc",
  locked: false,
  prunable: false,
  tests: emptyTests(),
  pr: null,
});

export function storeWithFront(...ids: string[]): Store {
  const store = new Store();
  store.emit({ type: "repo.upserted", repo: TEST_REPO });
  for (const id of ids.length ? ids : ["f1"]) store.emit({ type: "front.upserted", front: testFront(id) });
  return store;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
