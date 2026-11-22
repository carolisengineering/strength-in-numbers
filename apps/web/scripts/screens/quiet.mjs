/**
 * Minor 690: the app's Hevy pacer skips the first minute of each UTC hour (`features/hevy/client/pacer.ts`), which
 * outlasts the harness's 15 s waits. A step that talks to the fake Hevy and may run `aheadMs` waits until 1:05 past the
 * hour when it would reach the quiet minute before it ends, or starts inside it; at any other time it waits nothing.
 */
const HOUR_MS = 3_600_000;
const RESUME_MS = 65_000; // 1:05 past the hour: the quiet minute and a margin

/** Milliseconds to wait before a Hevy step that starts at `nowMs` and may run `aheadMs` (default one minute). */
export function quietMinuteWaitMs(nowMs, aheadMs = 60_000) {
  const into = ((nowMs % HOUR_MS) + HOUR_MS) % HOUR_MS;
  if (into >= HOUR_MS - aheadMs) return HOUR_MS - into + RESUME_MS;
  if (into < RESUME_MS) return RESUME_MS - into;
  return 0;
}
