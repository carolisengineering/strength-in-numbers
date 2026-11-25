import type { SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { setListed } from "./undoOffer";

/**
 * When the current panel may be shown again (Spec 17.4 AC14, AC15): a log's set count is listed, or the row an Undo
 * deleted is gone (minor 428). Each gate carries the lifter's choice count when it was set (`choiceNow()`, minors 710,
 * 713), so a tap on another card since then drops it (minor 417), and nothing else does.
 */
export type RevealGate = { kind: "count"; sets: number; choice: number } | { kind: "gone"; set: SetEntry; choice: number };

/**
 * What the gate does on this render. Pure. A gate is dropped once the lifter has chosen another card since it was set,
 * so a tap elsewhere never scrolls for a log or an Undo made before it; a move the lifter didn't make (an added
 * exercise still loading, a fallback after a removal) doesn't drop it (minor 710).
 */
export function revealStep(
  gate: RevealGate,
  view: { totalSets: number; exercises: readonly WorkoutExerciseDetail[]; choice: number },
): "wait" | "reveal" | "drop" {
  if (gate.choice !== view.choice) return "drop";
  if (gate.kind === "count") return view.totalSets >= gate.sets ? "reveal" : "wait";
  return view.exercises.some((e) => setListed(e.sets, gate.set)) ? "wait" : "reveal";
}
