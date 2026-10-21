const defaultOffset = (d: Date): number => d.getTimezoneOffset();

/** Minutes EAST of UTC (the API's `tzOffsetMinutes`): the negation of getTimezoneOffset(). */
export function startWorkoutFields(
  now: Date,
  tzOffsetFn: (d: Date) => number = defaultOffset,
): { startedAt: string; tzOffsetMinutes: number } {
  // `0 - x` rather than `-x` so a UTC device yields +0, never -0.
  return { startedAt: now.toISOString(), tzOffsetMinutes: 0 - tzOffsetFn(now) };
}

/** `now`, clamped up to `startedAt` (Spec 05.0 §6.5 rejects endedAt < startedAt). */
export function finishTimestamp(startedAt: string, now: Date): string {
  return now.getTime() < new Date(startedAt).getTime() ? startedAt : now.toISOString();
}

/**
 * Spec 18.0 §6.6 (AC37): where Finish ends the workout. With a plan (a "took" set in Change Time) it is
 * start + plan; otherwise "now", as `finishTimestamp`.
 */
export function finishEndedAt(startedAt: string, plannedDurationSeconds: number | null, now: Date): string {
  return plannedDurationSeconds === null
    ? finishTimestamp(startedAt, now)
    : new Date(Date.parse(startedAt) + plannedDurationSeconds * 1000).toISOString();
}
