import { formatClock, type RoundTime, type SectionTimer } from "@sin/core";
import { TIMES_GAP, TIMES_READINGS_PREFIX, TIMES_ROUNDS_PREFIX, TIMES_SEPARATOR } from "./timerCopy";

/**
 * Spec 10.7 AC20 — `Rounds 3:41 · 3:38` for a Set Timer, `Round ends 4:10 · – · 12:50` for an
 * AMRAP / Time Cap: rounds 1 to the highest recorded, a missing round as `–`; `null` when empty.
 */
export function timesLine(timer: SectionTimer, roundTimes: readonly RoundTime[]): string | null {
  if (roundTimes.length === 0) return null;
  const byRound = new Map(roundTimes.map((t) => [t.round, t.seconds]));
  const last = Math.max(...byRound.keys());
  const values: string[] = [];
  for (let round = 1; round <= last; round += 1) {
    const seconds = byRound.get(round);
    values.push(seconds === undefined ? TIMES_GAP : formatClock(seconds));
  }
  const prefix = timer.format === "set_timer" ? TIMES_ROUNDS_PREFIX : TIMES_READINGS_PREFIX;
  return prefix + values.join(TIMES_SEPARATOR);
}
