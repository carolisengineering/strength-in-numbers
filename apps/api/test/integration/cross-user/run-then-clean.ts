/**
 * Minor 735: run a case, then its cleanup, and report the case's own failure first. A `finally` that throws replaces
 * the error the case threw, so a broken cleanup used to hide why the case failed. Here a failing case keeps its error
 * (a cleanup error is dropped), and a cleanup error surfaces only when the case passed.
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
  }
  if (failure !== undefined) throw failure.error;
}
