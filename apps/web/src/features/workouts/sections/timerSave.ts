import { timerChangeKeepsRecorded, timersEqual, type SectionTimer, type WorkoutSection } from "@sin/core";

export type TimerSaveDecision = { kind: "unchanged" } | { kind: "send" } | { kind: "confirm" };

/**
 * Spec 10.7 §6.3, AC16–AC17 — what saving `next` over the section's stored timer does: nothing when it is
 * the same plan; a plain send when nothing is recorded or the change keeps what is (same format, numbers
 * that still hold it); otherwise ask first, and send with `discardResult` once confirmed. The rule is
 * `@sin/core`'s `timerChangeKeepsRecorded`, the one the server answers `409 section-result-exists` by.
 */
export function decideTimerSave(stored: WorkoutSection, next: SectionTimer | null): TimerSaveDecision {
  if (timersEqual(stored.timer, next)) return { kind: "unchanged" };
  return timerChangeKeepsRecorded(stored.timer, next, stored.roundTimes, stored.result) ? { kind: "send" } : { kind: "confirm" };
}
