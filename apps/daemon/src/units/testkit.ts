import { emptyTests, type Front } from "@ww/shared";
import { Store } from "../store.ts";

export const testFront = (id = "f1"): Front => ({
  id,
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
  for (const id of ids.length ? ids : ["f1"]) store.emit({ type: "front.upserted", front: testFront(id) });
  return store;
}

export const tick = () => new Promise((r) => setTimeout(r, 0));
