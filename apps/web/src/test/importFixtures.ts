import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { Exercise } from "@sin/core";

import { exerciseId, makeExercise } from "./catalogFixtures";

/** Spec 10.4 AC18's committed paste: the five screenshots of the design brief (the core test fixture). */
export const HIRAYA_TEXT = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../../../../packages/core/test/fixtures/hiraya-2026-10-19.txt"),
  "utf8",
);

const BUILT_INS: ReadonlyArray<[string, Exercise["modality"]]> = [
  ["Barbell back squat", "weight_reps"],
  ["Barbell bench press", "weight_reps"],
  ["Conventional deadlift", "weight_reps"],
  ["Overhead press", "weight_reps"],
  ["Barbell row", "weight_reps"],
  ["Dumbbell lunge", "weight_reps"],
  ["Pull-up", "bodyweight_reps"],
  ["Weighted dip", "weighted_bodyweight"],
  ["Plank", "duration"],
  ["Treadmill run", "distance_duration"],
];

/** The ten built-ins (ids 1–10) plus a "Power Clean" (id 15), so the example has exact, similar and new cards. */
export const importCatalog: readonly Exercise[] = [
  ...BUILT_INS.map(([name, modality], i) =>
    makeExercise({ id: exerciseId(i + 1), name, modality, primaryMuscleId: null, equipmentId: null }),
  ),
  makeExercise({ id: exerciseId(15), name: "Power Clean", modality: "weight_reps", primaryMuscleId: null, equipmentId: null }),
];

/** Every pathname the router passes through (a redirect's target included), for asserting a navigation happened. */
export function trackPaths(router: { subscribe: (fn: (state: { location: { pathname: string } }) => void) => unknown }): string[] {
  const seen: string[] = [];
  router.subscribe((state) => seen.push(state.location.pathname));
  return seen;
}
