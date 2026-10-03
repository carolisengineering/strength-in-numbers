import { createContext, useContext, useSyncExternalStore } from "react";
import type { Outbox, OutboxState } from "./outbox";

export const OutboxContext = createContext<Outbox | null>(null);

const EMPTY: OutboxState = { ops: [], idMap: {}, online: true, conflict: false };
const noSubscribe = () => () => {};
const emptyState = () => EMPTY;

export function useOutbox(): Outbox | null {
  return useContext(OutboxContext);
}

/** The outbox's state, re-rendering on change. Empty (and online) where no provider is mounted. */
export function useOutboxState(): OutboxState {
  const outbox = useContext(OutboxContext);
  return useSyncExternalStore(outbox ? outbox.subscribe : noSubscribe, outbox ? outbox.getState : emptyState);
}
