/**
 * Spec 10.7 AC50: pastes built in the shape of the three Hiraya fixtures (no new screenshot text), each naming the
 * section that carries the timer and the timer the reader should give it (`null` = untimed).
 */
import type { SectionTimer } from "../../src/dto/section-timer.js";

export type TimerPasteName =
  | "setTimerAccessory"
  | "timeCapColon"
  | "twelveMinAmrap"
  | "amrapClock"
  | "bareForTime"
  | "scoreLineTime"
  | "scoreLineRounds"
  | "badgeBeatsScoreLine"
  | "amrapBullets"
  | "timeCapBulletSingle";

export interface TimerPaste {
  readonly raw: string;
  readonly section: string;
  readonly timer: SectionTimer | null;
}

export const TIMER_PASTES: Readonly<Record<TimerPasteName, TimerPaste>> = {
  // Fixture 24's Accessory block with its NO SCORE badge swapped for TIME: 4 items in one run.
  setTimerAccessory: {
    raw: "Accessory\nTIME\n3 Sets, 1 Set Every 4:00\n10-15 Double DB Bench Press\n15 DB or Plate Front Raises\n10 Tuckups + 15 Hollow Rocks",
    section: "Accessory",
    timer: { format: "set_timer", rounds: 3, roundSeconds: 240 },
  },
  timeCapColon: {
    raw: "Main\nTIME\nTime cap: 15:00\n21-15-9\nThrusters\nPull-ups",
    section: "Main",
    timer: { format: "time_cap", capSeconds: 900 },
  },
  twelveMinAmrap: {
    raw: "Main\nROUNDS/REPS\n12 Min AMRAP\n10 Burpees\n15 Air Squats",
    section: "Main",
    timer: { format: "amrap", capSeconds: 720 },
  },
  amrapClock: {
    raw: "Main\nROUNDS\nAMRAP 12:00\n10 Burpees\n15 Air Squats",
    section: "Main",
    timer: { format: "amrap", capSeconds: 720 },
  },
  bareForTime: {
    raw: "Main\nTIME\nFor Time:\n21-15-9\nThrusters\nPull-ups",
    section: "Main",
    timer: { format: "time_cap", capSeconds: null },
  },
  // No badge: `Strength` is a strict heading and the Score line decides.
  scoreLineTime: {
    raw: "Strength\n20 Minute Cap\nScore: Time to complete.\n21-15-9\nThrusters\nPull-ups",
    section: "Strength",
    timer: { format: "time_cap", capSeconds: 1200 },
  },
  scoreLineRounds: {
    raw: "Strength\nAMRAP 15\nScore: Total rounds + reps.\n10 Burpees\n15 Air Squats",
    section: "Strength",
    timer: { format: "amrap", capSeconds: 900 },
  },
  badgeBeatsScoreLine: {
    raw: "Main\nWEIGHT\nScore: time\n20 Minute Cap\n21-15-9\nThrusters\nPull-ups",
    section: "Main",
    timer: null,
  },
  // Two bulleted items with no run.
  amrapBullets: {
    raw: "Main\nROUNDS/REPS\nAMRAP 10\n- 10 Burpees\n- 15 Air Squats",
    section: "Main",
    timer: { format: "amrap", capSeconds: 600 },
  },
  // One bulleted item, no run.
  timeCapBulletSingle: {
    raw: "Main\nTIME\nFor Time:\n- 50 Burpees",
    section: "Main",
    timer: { format: "time_cap", capSeconds: null },
  },
};
