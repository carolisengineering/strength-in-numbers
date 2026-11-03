import { describeTimer, scoreText, type SectionScore, type TimedSectionSummary } from "@sin/core";
import { TIMES_SEPARATOR } from "./timerCopy";

/** History shows at most this many timed sections per row (Spec 10.7 D16); the rest are "+n more". */
const HISTORY_TIMED_LINES_MAX = 2;

type Scored = TimedSectionSummary & { score: SectionScore };

/** Spec 10.7 AC21 — `Main · Set Timer 5 × 5:00 · total 17:42`. Meant for a scored section; History never draws an unscored one. */
export function timedSectionLine(s: TimedSectionSummary): string {
  const parts = [s.name, describeTimer(s.timer)];
  if (s.score !== null) parts.push(scoreText(s.score));
  return parts.join(TIMES_SEPARATOR);
}

/** Spec 10.7 AC21 — the scored sections in position order: the first two as lines, the rest counted. */
export function historyTimedLines(list: readonly TimedSectionSummary[]): { lines: string[]; more: number } {
  const scored = list.filter((s): s is Scored => s.score !== null).sort((a, b) => a.position - b.position);
  return {
    lines: scored.slice(0, HISTORY_TIMED_LINES_MAX).map(timedSectionLine),
    more: Math.max(0, scored.length - HISTORY_TIMED_LINES_MAX),
  };
}
