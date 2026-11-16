import { describe, expect, it } from "vitest";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import type { FinishOp } from "./ops";
import { project } from "./project";

const workout = makeWorkoutDetail({
  exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1 })] }],
});
const finish = (status: FinishOp["status"]): FinishOp => ({
  id: `op-${status}`,
  workoutId: workout.id,
  userId: "u",
  status,
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "finish",
  body: { endedAt: "2026-11-08T10:15:00.000Z" },
  meta: { startedAt: workout.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
});

describe("06.7 AC1 — project() never applies a finish op (§6.2: the active workout never shows an unsent finish)", () => {
  it.each(["queued", "sending", "failed"] as const)("a %s finish op leaves the workout and its sync marks untouched", (status) => {
    const out = project(workout, { ops: [finish(status)], idMap: {} });
    expect(out.workout).toBe(workout);
    expect(out.sync.size).toBe(0);
  });
});
