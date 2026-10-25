import { matchQuery, type QueryClient, type QueryKey } from "@tanstack/react-query";

/**
 * A write that patches a cached workout from its own response must not be undone by a read of that workout
 * answered from before the commit (§6.2, AC11). `guardReads` runs in the write's `onMutate`: it cancels a read
 * already in flight and watches for one that STARTS while the write is pending — a window-focus refetch, say
 * (#154). `rereadIfStale` runs in `onSettled`: if either happened, the workout is read once more.
 */
export interface ReadGuard {
  /** Stops watching. True when a read was interrupted or started meanwhile; every later call returns false. */
  finish(): boolean;
}

export async function guardReads(queryClient: QueryClient, queryKey: QueryKey): Promise<ReadGuard> {
  const interrupted = queryClient.isFetching({ queryKey }) > 0;
  await queryClient.cancelQueries({ queryKey });
  let started = false;
  let done = false;
  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.action.type === "fetch" && matchQuery({ queryKey }, event.query)) started = true;
  });
  return {
    finish: () => {
      if (done) return false;
      done = true;
      unsubscribe();
      return interrupted || started;
    },
  };
}

/** Not awaited: a set write must not wait for the re-read (logging stays instant). */
export function rereadIfStale(queryClient: QueryClient, queryKey: QueryKey, guard: ReadGuard | undefined): void {
  if (guard?.finish()) void queryClient.invalidateQueries({ queryKey });
}

/**
 * A structure write (a section remove or move) changes other rows, so it re-reads the workout and resolves only
 * once the answer has landed (Spec 10.6 §6.4). A set write started meanwhile cancels that read (its `guardReads`);
 * ask again, up to three times, rather than resolve on the old list (#158). A read that fails is not retried, and
 * nothing is read for a screen that has gone (no observer). After three cancels it resolves on what is cached; the
 * move's reveal then stays unarmed (`useRevealMoved`), and the next read shows the change.
 */
export async function rereadUntilLanded(queryClient: QueryClient, queryKey: QueryKey): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const before = queryClient.getQueryState(queryKey);
    await queryClient.invalidateQueries({ queryKey });
    const query = queryClient.getQueryCache().find({ queryKey, exact: true }); // the one workout entry itself
    const after = query?.state;
    if (!before || !after || query.getObserversCount() === 0) return;
    if (after.dataUpdatedAt !== before.dataUpdatedAt || after.errorUpdatedAt !== before.errorUpdatedAt) return;
  }
}
