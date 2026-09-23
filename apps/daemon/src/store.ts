import { applyEvent, emptyState, type ServerEvent, type WarState } from "@ww/shared";

type Listener = (ev: ServerEvent) => void;

/**
 * The daemon's authoritative state. Every change goes through `emit`, which runs
 * the shared reducer and then broadcasts, so clients replaying the same events
 * over a snapshot end up with exactly this state.
 */
export class Store {
  #state: WarState = emptyState();
  #listeners = new Set<Listener>();

  get state(): WarState {
    return this.#state;
  }

  emit(ev: ServerEvent): void {
    this.#state = applyEvent(this.#state, ev);
    for (const l of this.#listeners) l(ev);
  }

  subscribe(l: Listener): () => void {
    this.#listeners.add(l);
    return () => this.#listeners.delete(l);
  }
}
