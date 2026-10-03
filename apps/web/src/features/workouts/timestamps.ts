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
