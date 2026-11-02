import type { RoundTime, SectionResult, SectionTimer } from "../dto/section-timer.js";
import { describeTimer, formatClock, scoreText, sectionScore } from "../timer.js";

/** A timed section as the Hevy export reads it (Spec 09.5 §6.7): the DTO fields, with the timer set. */
export type TimedSectionData = { timer: SectionTimer; result: SectionResult | null; roundTimes: readonly RoundTime[] };

/**
 * Spec 09.5 AC28: the line a timed section carries in its Hevy notes. Segments joined by " · ": the timer
 * description; the recorded round times in round order (a gap is not marked; omitted when none); the score
 * text (omitted when there is no score). Clock and score text come only from `timer.ts`.
 */
export function hevyTimerLine(s: TimedSectionData): string {
  const segments = [describeTimer(s.timer)];
  if (s.roundTimes.length > 0) {
    segments.push([...s.roundTimes].sort((a, b) => a.round - b.round).map((r) => formatClock(r.seconds)).join(", "));
  }
  const score = sectionScore(s);
  if (score !== null) segments.push(scoreText(score));
  return segments.join(" · ");
}

/**
 * Spec 09.5 §6.7: the duration of the marker's single set, or `null` when no set is sent. Set Timer: the total
 * of the round times; AMRAP: its time limit; Time Cap: the finish time, or the cap when capped (O1).
 */
export function hevyTimerDurationSeconds(s: TimedSectionData): number | null {
  if (s.timer.format === "amrap") return s.timer.capSeconds;
  const score = sectionScore(s);
  if (score === null) return null;
  switch (score.kind) {
    case "total_time":
    case "finish_time":
      return score.seconds;
    case "capped":
      return s.timer.format === "time_cap" ? s.timer.capSeconds : null;
    case "rounds_reps":
      return null;
  }
}
