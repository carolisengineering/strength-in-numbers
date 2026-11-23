import type { SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { setListed } from "./undoOffer";

/**
 * When the current panel may be shown again (Spec 17.4 AC14, AC15): a log's set count is listed, or the row an Undo
 * deleted is gone (minor 428). A log's gate names the exercise it reveals (minor 417): the next one on an advance, else
 * the logged one.
 */
export type RevealGate = { kind: "count"; sets: number; id: string } | { kind: "gone"; set: SetEntry };

/**
 * What the gate does on this render. Pure. A log's gate is dropped once current is no longer the exercise it was for,
 * so a tap on another card never scrolls that card's panel for a log made elsewhere (minor 417).
 */
export function revealStep(
  gate: RevealGate,
  view: { totalSets: number; exercises: readonly WorkoutExerciseDetail[]; currentId: string | null },
): "wait" | "reveal" | "drop" {
  if (gate.kind === "count") {
    if (view.currentId !== gate.id) return "drop";
    return view.totalSets >= gate.sets ? "reveal" : "wait";
  }
  return view.exercises.some((e) => setListed(e.sets, gate.set)) ? "wait" : "reveal";
}
