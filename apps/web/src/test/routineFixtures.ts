import { exerciseId, makeExercise } from "./catalogFixtures";
import { makeRoutine, makeRoutineItem, makeRoutineSection, routineId, sectionId } from "./workoutFixtures";

/** Spec 10.0 screen fixtures: three active exercises and one retired. */
export const catalog = [
  makeExercise({ id: exerciseId(1), name: "Bench Press" }),
  makeExercise({ id: exerciseId(2), name: "Barbell Row" }),
  makeExercise({ id: exerciseId(3), name: "Overhead Press" }),
  makeExercise({ id: exerciseId(4), name: "Old Fly", isActive: false }),
];

/** Bench + Row in superset 1, then Overhead Press. */
export const pushA = makeRoutine({
  id: routineId(1),
  name: "Push A",
  notes: "Heavy day",
  items: [
    makeRoutineItem({ position: 0, exerciseId: exerciseId(1), targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, targetRpe: 8.5, restSeconds: 120, supersetGroup: 1 }),
    makeRoutineItem({ position: 1, exerciseId: exerciseId(2), targetSets: 4, targetRepsLow: 8, targetRepsHigh: 10, supersetGroup: 1, notes: "Pause at top" }),
    makeRoutineItem({ position: 2, exerciseId: exerciseId(3), targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8 }),
  ],
});

/** Loose Overhead Press; an empty "Warm-up" section with a note; "Main" with Bench + Row as superset 1. */
export const pushSectioned = makeRoutine({
  id: routineId(2),
  name: "Push B",
  notes: "Keep the session under 75 minutes",
  sections: [
    makeRoutineSection({ id: sectionId(1), position: 0, name: "Warm-up", notes: "5 min rower, then band pull-aparts" }),
    makeRoutineSection({ id: sectionId(2), position: 1, name: "Main", notes: null }),
  ],
  items: [
    makeRoutineItem({ position: 0, exerciseId: exerciseId(3) }),
    makeRoutineItem({ position: 1, exerciseId: exerciseId(1), sectionId: sectionId(2), supersetGroup: 1, targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8 }),
    makeRoutineItem({ position: 2, exerciseId: exerciseId(2), sectionId: sectionId(2), supersetGroup: 1, notes: "Pause at top" }),
  ],
});
