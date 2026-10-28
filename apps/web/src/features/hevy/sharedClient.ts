import { createHevyClient, type HevyClient } from "./client/hevyClient";
import { createPacer, type Pacer } from "./client/pacer";

/**
 * Spec 20.0 AC10: one pacer for every Hevy client on this page, so the key check, a template read and (20.1, 20.2)
 * every import or send queue on the same 600 ms gap and the same quiet minute.
 */

/** A real wait that an abort ends early. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

let sharedPacer: Pacer = createPacer({ now: () => Date.now(), sleep });
let retrySleep: (ms: number, signal?: AbortSignal) => Promise<void> = sleep;

/** Test-only: a pacer whose waits return at once. */
export function setSharedPacerForTests(pacer: Pacer): void {
  sharedPacer = pacer;
}

/** Test-only: the wait between `GET` retries (1 s, 2 s, 4 s in the app). */
export function setRetrySleepForTests(fn: (ms: number, signal?: AbortSignal) => Promise<void>): void {
  retrySleep = fn;
}

/** Every client goes through this, so a pacer swapped in a test reaches clients built before it. */
const pacerProxy: Pacer = {
  wait: (signal) => sharedPacer.wait(signal),
  deferUntil: (atMs) => sharedPacer.deferUntil(atMs),
};

/** A client that sends whatever key `getKey` returns at the moment of each request. */
export function hevyClientFor(getKey: () => string | null): HevyClient {
  return createHevyClient({
    // Read at call time, so the page's current fetch (and a test's interceptor) is the one used.
    fetch: (input, init) => window.fetch(input, init),
    getKey,
    pacer: pacerProxy,
    sleep: (ms, signal) => retrySleep(ms, signal),
    now: () => Date.now(),
  });
}
