import type { RoundTime, TimerFormat } from "@sin/core";

/** One round's write: a time to set, or `null` to clear it. */
export type RoundWrite = { round: number; seconds: number | null };

/**
 * Spec 10.7 AC32, D8 — the round writes that turn `existing` into `final`, in an order in which each is valid
 * against the state the ones before it left. An AMRAP / Time Cap reading must sit strictly between its neighbors,
 * so: the clears first (ascending), then the rounds whose value went down (ascending), then the rounds that went up
 * or are new (descending). A Set Timer's rounds are independent, so every write goes in ascending order. A round
 * whose value did not change gets no write. Pure.
 */
export function orderRoundWrites(format: TimerFormat, existing: readonly RoundTime[], final: readonly RoundTime[]): RoundWrite[] {
  const before = new Map(existing.map((t) => [t.round, t.seconds]));
  const after = new Map(final.map((t) => [t.round, t.seconds]));
  const clears: RoundWrite[] = [...before.keys()].filter((r) => !after.has(r)).map((round) => ({ round, seconds: null }));
  const changed = [...after.entries()].filter(([round, seconds]) => before.get(round) !== seconds).map(([round, seconds]) => ({ round, seconds }));
  const ascending = (a: RoundWrite, b: RoundWrite) => a.round - b.round;
  if (format === "set_timer") return [...clears, ...changed].sort(ascending);
  const down = changed.filter((w) => before.has(w.round) && w.seconds < before.get(w.round)!).sort(ascending);
  const up = changed.filter((w) => !before.has(w.round) || w.seconds > before.get(w.round)!).sort((a, b) => b.round - a.round);
  return [...clears.sort(ascending), ...down, ...up];
}
