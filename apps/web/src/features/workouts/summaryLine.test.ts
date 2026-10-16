import type { Modality, PlannedSet } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import type { RowSync } from "./outbox/project";
import { collapsedSummary, collapsedSync } from "./summaryLine";
import { supersetRows } from "./supersetRows";

const row = (unit: "kg" | "lb", setType: PlannedSet["setType"] = "working", reps: [number | null, number | null] = [5, 5], weight: number | null = 185): PlannedSet => ({
  setType,
  repsLow: reps[0],
  repsHigh: reps[1],
  weight,
  weightUnit: weight === null ? null : unit,
});
const sets = (n: number) => Array.from({ length: n }, (_, i) => makeSet({ setNumber: i + 1 }));
const rowsFor = (specs: ExerciseSpec[]) => supersetRows(makeWorkoutDetail({ exercises: specs }).exercises);
const one = (spec: Partial<ExerciseSpec> & { modality?: Modality }, unit: "kg" | "lb" = "lb") =>
  collapsedSummary(rowsFor([{ modality: "weight_reps", name: "Bench Press", ...spec }])[0]!, unit);

describe("17.1 AC10 — the collapsed summary table (§6.2)", () => {
  it("done: '{name} · {logged} sets' with the check", () => {
    expect(one({ plannedSets: [row("lb"), row("lb"), row("lb")], sets: sets(3) })).toEqual({
      text: "Bench Press · 3 sets",
      name: "Bench Press, 3 sets logged",
      done: true,
    });
  });

  it("partly done: '{logged} of {planned} · next {next}'; the name carries the unit", () => {
    expect(one({ plannedSets: [row("lb"), row("lb"), row("lb"), row("lb")], sets: sets(2) })).toEqual({
      text: "Bench Press · 2 of 4 · next 185 × 5",
      name: "Bench Press, 2 of 4 sets logged, next 185 lb × 5",
      done: false,
    });
  });

  it("upcoming: 'next {next}', a rep range as low–high", () => {
    expect(one({ name: "Overhead Press", plannedSets: [row("lb", "working", [6, 8], 105)] })).toMatchObject({
      text: "Overhead Press · next 105 × 6–8",
      done: false,
    });
  });

  it("appends the weight unit only when it differs from the profile's", () => {
    expect(one({ plannedSets: [row("kg", "working", [5, 5], 82.5)] }, "lb").text).toBe("Bench Press · next 82.5 kg × 5");
    expect(one({ plannedSets: [row("kg", "working", [5, 5], 82.5)] }, "kg").text).toBe("Bench Press · next 82.5 × 5");
  });

  it("a non-working next row appends its type", () => {
    expect(one({ plannedSets: [row("lb", "warmup", [8, 8], 45)] }).text).toBe("Bench Press · next 45 × 8 · Warm-up");
  });

  it("weighted bodyweight shows +weight; bodyweight shows reps; a row with no weight shows reps; no reps shows the set number", () => {
    expect(one({ modality: "weighted_bodyweight", name: "Dip", plannedSets: [row("lb", "working", [8, 8], 25)] }).text).toBe("Dip · next +25 × 8");
    expect(one({ modality: "bodyweight_reps", name: "Pull-up", plannedSets: [row("lb", "working", [1, 1], null)] }).text).toBe("Pull-up · next 1 rep");
    expect(one({ plannedSets: [row("lb", "working", [12, 12], null)] }).text).toBe("Bench Press · next 12 reps");
    expect(one({ modality: "duration", name: "Plank", plannedSets: [row("lb", "working", [null, null], null)], sets: [] }).text).toBe("Plank · next set 1");
  });

  it("open with sets: '{logged} sets', never a check; open with none: the target line, else 'no sets yet'", () => {
    expect(one({ name: "Curl", sets: sets(2) })).toEqual({ text: "Curl · 2 sets", name: "Curl, 2 sets logged", done: false });
    expect(one({ name: "Curl", sets: sets(1) }).text).toBe("Curl · 1 set");
    expect(one({ name: "Triceps Pushdown", targetSets: 3, targetRepsLow: 12, targetRepsHigh: 12 }).text).toBe("Triceps Pushdown · 3 × 12");
    expect(one({ name: "Curl" })).toEqual({ text: "Curl · no sets yet", name: "Curl, no sets yet", done: false });
  });

  it("a superset member's name begins 'Name, superset N' (the on-screen ordinal)", () => {
    const rows = rowsFor([
      { modality: "weight_reps", name: "Bench Press", supersetGroup: 7, plannedSets: [row("lb"), row("lb"), row("lb")], sets: sets(3) },
      { modality: "weight_reps", name: "Row", supersetGroup: 7 },
    ]);
    expect(collapsedSummary(rows[0]!, "lb").name).toBe("Bench Press, superset 1, 3 sets logged");
  });
});

describe("17.1 AC10 — collapsed rows report queued and failed writes (06.2)", () => {
  it("failed wins over pending; the note counts; synced is null", () => {
    const [r] = rowsFor([{ modality: "weight_reps", name: "X", sets: sets(2) }]);
    const exercise = r!.exercise;
    const [a, b] = exercise.sets;
    const pending: RowSync = { state: "pending" };
    const failed: RowSync = { state: "failed", opId: "op", status: 422 };
    expect(collapsedSync(exercise, new Map())).toBeNull();
    expect(collapsedSync(exercise, new Map([[a!.id, pending]]))).toBe("pending");
    expect(collapsedSync(exercise, new Map([[a!.id, pending], [b!.id, failed]]))).toBe("failed");
    expect(collapsedSync(exercise, new Map([[exercise.id, failed]]))).toBe("failed");
  });
});
