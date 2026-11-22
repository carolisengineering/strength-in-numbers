/**
 * Minor 690: the app's Hevy pacer skips the first minute of each UTC hour (`features/hevy/client/pacer.ts`), which
 * outlasts the harness's 15 s waits. A step that talks to the fake Hevy waits until 1:05 past the hour when it would
 * start in the minute before the hour or in the quiet minute itself; at any other time it waits nothing.
 */
const HOUR_MS = 3_600_000;
const QUIET_START_MS = 59 * 60_000; // 59:00 into the hour: a step started now would run into the quiet minute
const RESUME_MS = 65_000; // 1:05 past the hour: the quiet minute and a margin

/** Milliseconds to wait before a Hevy step that starts at `nowMs`. */
export function quietMinuteWaitMs(nowMs) {
  const into = ((nowMs % HOUR_MS) + HOUR_MS) % HOUR_MS;
  if (into >= QUIET_START_MS) return HOUR_MS - into + RESUME_MS;
  if (into < RESUME_MS) return RESUME_MS - into;
  return 0;
}
