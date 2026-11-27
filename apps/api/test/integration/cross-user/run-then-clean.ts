/**
 * Minor 735: run a case, then its cleanup, and report the case's own failure first. A `finally` that throws replaces
 * the error the case threw, so a broken cleanup used to hide why the case failed. Here a failing case keeps its error,
 * and a cleanup error surfaces on its own only when the case passed. Minor 776: when both fail, the cleanup's error is
 * kept as the case error's `cause` (unless it already has one; Vitest prints "Caused by:") and is always printed with
 * `console.error`, which Vitest shows under the test that ran it, so a broken cleanup is never silent.
 */
export async function runThenClean(run: () => Promise<void>, cleanup: (() => Promise<void>) | undefined): Promise<void> {
  let failure: { error: unknown } | undefined;
  try {
    await run();
  } catch (error) {
    failure = { error };
  }
  try {
    await cleanup?.();
  } catch (error) {
    if (failure === undefined) throw error;
    console.error("cross-user case: the cleanup failed too, after the case's own failure:", error);
    if (failure.error instanceof Error && failure.error.cause === undefined) failure.error.cause = error;
  }
  if (failure !== undefined) throw failure.error;
}
