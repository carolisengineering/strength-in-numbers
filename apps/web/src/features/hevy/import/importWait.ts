import { sleep } from "../sharedClient";

/**
 * Spec 20.1 AC18–AC20, AC23: the wait the run and the routines step use (the batch gap, a retry, a `429`, the routine
 * gap). It is 20.0's abortable `sleep`, so a Stop or an unmount ends it at once; tests swap in an instant one.
 */
let wait: (ms: number, signal?: AbortSignal) => Promise<void> = sleep;

export const importWait = (ms: number, signal?: AbortSignal): Promise<void> => wait(ms, signal);

/** Test-only: a wait that returns at once (still rejecting when its signal is aborted). */
export function setImportWaitForTests(fn: (ms: number, signal?: AbortSignal) => Promise<void>): void {
  wait = fn;
}
