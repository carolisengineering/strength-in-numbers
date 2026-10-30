/**
 * Spec 20.1 §6.8: one queue for this page's real batches and finishes, so a finish waits for the batch in flight and
 * no batch starts while a finish is in flight (a long finish holds the row a concurrent batch's write needs). It is
 * module-level on purpose: the import screen and the Hevy screen's stale-records banner share it, and a batch whose
 * screen was left still holds its place until the server answers. React-free.
 */

let tail: Promise<unknown> = Promise.resolve();

export const importLane = {
  /** Runs `fn` after every earlier call has settled; a rejection reaches its own caller and never blocks the next. */
  run<T>(fn: () => Promise<T>): Promise<T> {
    const result = tail.then(fn);
    tail = result.catch(() => undefined);
    return result;
  },
};

/** Test-only: a test that leaves a call hanging must not hold the next test's lane. */
export function resetImportLaneForTests(): void {
  tail = Promise.resolve();
}
