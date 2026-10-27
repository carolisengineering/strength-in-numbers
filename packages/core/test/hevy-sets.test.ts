import { describe, expect, it } from "vitest";
import {
  HEVY_TYPE_VALUES,
  hevySetToSin,
  sinSetToHevy,
  type HevyImportCtx,
  type HevySet,
  type HevyType,
  type MeasureRule,
  type Modality,
  type SetEntry,
} from "../src/index.js";

const NULLS = { weight_kg: null, reps: null, distance_meters: null, duration_seconds: null, custom_metric: null, rpe: null };
type HevyInput = Partial<Omit<HevySet, "type">> & { type?: "warmup" | "normal" | "failure" | "dropset" };
const hevy = (o: HevyInput) => ({ ...NULLS, type: "normal" as const, ...o });
const ctx = (hevyType: HevyType, modality: Modality, rule: MeasureRule | null = null, unit: "kg" | "lb" = "kg"): HevyImportCtx => ({
  hevyType,
  modality,
  rule,
  unit,
});

describe("19.0 AC6 — import set types", () => {
  it.each([
    ["warmup", "warmup"],
    ["normal", "working"],
    ["dropset", "drop"],
    ["failure", "failure"],
  ] as const)("%s → %s", (type, setType) => {
    const r = hevySetToSin(hevy({ type, weight_kg: 50, reps: 5 }), ctx("weight_reps", "weight_reps"));
    expect(r.ok && r.set.setType).toBe(setType);
  });
});

describe("19.0 AC6 — weight rounding", () => {
  it("61.235 kg is 135 lb and 61.2 kg", () => {
    const lb = hevySetToSin(hevy({ weight_kg: 61.235, reps: 5 }), ctx("weight_reps", "weight_reps", null, "lb"));
    const kg = hevySetToSin(hevy({ weight_kg: 61.235, reps: 5 }), ctx("weight_reps", "weight_reps", null, "kg"));
    expect(lb.ok && [lb.set.weight, lb.set.weightUnit]).toEqual([135, "lb"]);
    expect(kg.ok && [kg.set.weight, kg.set.weightUnit]).toEqual([61.2, "kg"]);
  });

  it("0.04 kg is 0 for a kg user", () => {
    const r = hevySetToSin(hevy({ weight_kg: 0.04, reps: 5 }), ctx("weight_reps", "weight_reps"));
    expect(r.ok && r.set.weight).toBe(0);
  });

  it("Review Focus 2: 20.411656 kg reads 45 lb, not 44.9", () => {
    const r = hevySetToSin(hevy({ weight_kg: 20.411656, reps: 5 }), ctx("weight_reps", "weight_reps", null, "lb"));
    expect(r.ok && r.set.weight).toBe(45);
  });
});

describe("19.0 AC6 — measures per type × modality", () => {
  const CASES: [string, HevyImportCtx, HevyInput, Record<string, unknown>][] = [
    ["weight_reps → weight_reps", ctx("weight_reps", "weight_reps"), { weight_kg: 100, reps: 5 }, { weight: 100, weightUnit: "kg", reps: 5 }],
    ["weight_reps → weighted_bodyweight", ctx("weight_reps", "weighted_bodyweight"), { weight_kg: 100, reps: 5 }, { weight: 100, reps: 5 }],
    ["bodyweight_reps → weight_reps", ctx("bodyweight_reps", "weight_reps"), { weight_kg: 10, reps: 8 }, { weight: 10, reps: 8 }],
    ["bodyweight_reps → weighted_bodyweight", ctx("bodyweight_reps", "weighted_bodyweight"), { weight_kg: 10, reps: 8 }, { weight: 10, reps: 8 }],
    ["reps_only → bodyweight_reps", ctx("reps_only", "bodyweight_reps"), { reps: 12 }, { reps: 12, weight: null, weightUnit: null }],
    ["reps_only → calories (rule)", ctx("reps_only", "calories", "calories_as_reps"), { reps: 20 }, { calories: 20, reps: null }],
    ["assisted → bodyweight_reps (rule)", ctx("bodyweight_assisted_reps", "bodyweight_reps", "assist_weight_ignored"), { weight_kg: 20, reps: 6 }, { reps: 6, weight: null }],
    ["duration → duration", ctx("duration", "duration"), { duration_seconds: 60 }, { durationS: 60 }],
    ["weight_duration → weight_duration", ctx("weight_duration", "weight_duration"), { weight_kg: 24, duration_seconds: 45 }, { weight: 24, durationS: 45 }],
    ["distance_duration → distance_duration", ctx("distance_duration", "distance_duration"), { distance_meters: 1000, duration_seconds: 300 }, { distance: 1000, distanceUnit: "m", durationS: 300 }],
    ["short_distance_weight → weight_distance", ctx("short_distance_weight", "weight_distance"), { weight_kg: 32, distance_meters: 40 }, { weight: 32, distance: 40, distanceUnit: "m" }],
  ];

  it.each(CASES)("%s", (_l, c, input, expected) => {
    const r = hevySetToSin(hevy(input), c);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.set).toMatchObject(expected);
    expect(r.set.isComplete).toBe(true);
    expect([null, "m"]).toContain(r.set.distanceUnit);
  });

  it("a forbidden measure at 0 is ignored and counted; at null it is just absent", () => {
    const zero = hevySetToSin(hevy({ reps: 12, weight_kg: 0 }), ctx("reps_only", "bodyweight_reps"));
    expect(zero.ok && zero.set.weight).toBe(null);
    expect(zero.ok && zero.ignored).toEqual(["zero_forbidden"]);
    const none = hevySetToSin(hevy({ reps: 12 }), ctx("reps_only", "bodyweight_reps"));
    expect(none.ok && none.ignored).toEqual([]);
  });

  it("a non-zero forbidden measure is forbidden_measure", () => {
    expect(hevySetToSin(hevy({ reps: 12, duration_seconds: 30 }), ctx("reps_only", "bodyweight_reps"))).toEqual({ ok: false, reason: "forbidden_measure" });
  });

  it.each(["normal", "warmup"] as const)("a missing required measure on a %s set is missing_measure (D9)", (type) => {
    expect(hevySetToSin(hevy({ type, weight_kg: 50 }), ctx("weight_reps", "weight_reps"))).toEqual({ ok: false, reason: "missing_measure" });
  });

  it("reps above SET_REPS_MAX is out_of_range", () => {
    expect(hevySetToSin(hevy({ weight_kg: 50, reps: 40000 }), ctx("weight_reps", "weight_reps"))).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("custom_metric is ignored and counted; the set is kept", () => {
    const r = hevySetToSin(hevy({ duration_seconds: 600, custom_metric: 12 }), ctx("duration", "duration"));
    expect(r.ok && r.ignored).toEqual(["custom_metric"]);
    expect(r.ok && r.set).not.toHaveProperty("customMetric");
  });

  it("rpe is kept as sent", () => {
    const r = hevySetToSin(hevy({ weight_kg: 50, reps: 5, rpe: 8.5 }), ctx("weight_reps", "weight_reps"));
    expect(r.ok && r.set.rpe).toBe(8.5);
  });
});

describe("19.0 AC7 — measure rules", () => {
  it("calories_as_reps: reps become calories", () => {
    const r = hevySetToSin(hevy({ reps: 20 }), ctx("reps_only", "calories", "calories_as_reps"));
    expect(r.ok && [r.set.calories, r.set.reps]).toEqual([20, null]);
  });

  it("calories_as_reps: a non-zero weight is forbidden_measure", () => {
    expect(hevySetToSin(hevy({ reps: 20, weight_kg: 10 }), ctx("reps_only", "calories", "calories_as_reps"))).toEqual({ ok: false, reason: "forbidden_measure" });
  });

  it("calories_as_reps: above SET_CALORIES_MAX is out_of_range", () => {
    expect(hevySetToSin(hevy({ reps: 40000 }), ctx("reps_only", "calories", "calories_as_reps"))).toEqual({ ok: false, reason: "out_of_range" });
  });

  it("assist_weight_ignored: the assist weight is dropped and counted, the reps kept", () => {
    const r = hevySetToSin(hevy({ weight_kg: 20, reps: 6 }), ctx("bodyweight_assisted_reps", "bodyweight_reps", "assist_weight_ignored"));
    expect(r.ok && r.set.reps).toBe(6);
    expect(r.ok && r.set.weight).toBe(null);
    expect(r.ok && r.ignored).toEqual(["assist_weight"]);
  });
});

const sin = (o: Partial<SetEntry>): SetEntry => ({
  id: "018fcb3e-3b8a-7d6e-9c1a-000000000010" as SetEntry["id"],
  workoutExerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000005" as SetEntry["workoutExerciseId"],
  clientGeneratedId: null,
  setNumber: 1,
  setType: "working",
  reps: null,
  weight: null,
  weightUnit: null,
  weightKg: null,
  distance: null,
  distanceUnit: null,
  distanceM: null,
  durationS: null,
  calories: null,
  rpe: null,
  isComplete: true,
  completedAt: null,
  createdAt: "2026-10-01T10:00:00.000Z",
  updatedAt: "2026-10-01T10:00:00.000Z",
  ...o,
});

describe("19.0 AC8 — export fields per Hevy type", () => {
  const FULL = { reps: 5, weight: 60, weightUnit: "kg" as const, weightKg: 60, distance: 40, distanceUnit: "m" as const, distanceM: 40, durationS: 45 };
  const CASES: [HevyType, Modality, MeasureRule | null, string[]][] = [
    ["weight_reps", "weight_reps", null, ["weight_kg", "reps"]],
    ["reps_only", "bodyweight_reps", null, ["reps"]],
    ["bodyweight_reps", "weighted_bodyweight", null, ["weight_kg", "reps"]],
    ["bodyweight_assisted_reps", "bodyweight_reps", "assist_weight_ignored", ["reps"]],
    ["duration", "duration", null, ["duration_seconds"]],
    ["weight_duration", "weight_duration", null, ["weight_kg", "duration_seconds"]],
    ["distance_duration", "distance_duration", null, ["distance_meters", "duration_seconds"]],
    ["short_distance_weight", "weight_distance", null, ["weight_kg", "distance_meters"]],
  ];

  it("covers every Hevy type", () => {
    expect(CASES.map((c) => c[0]).sort()).toEqual([...HEVY_TYPE_VALUES].sort());
  });

  it.each(CASES)("%s writes only its fields, plus type and rpe", (hevyType, modality, rule, fields) => {
    const r = sinSetToHevy(sin(FULL), { hevyType, modality, rule });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.set).sort()).toEqual([...fields, "type", "rpe"].sort());
    expect(r.set).not.toHaveProperty("custom_metric");
  });

  it("weight_kg is the canonical weightKg (a lb set too)", () => {
    const r = sinSetToHevy(sin({ reps: 5, weight: 135, weightUnit: "lb", weightKg: 61.235 }), { hevyType: "weight_reps", modality: "weight_reps", rule: null });
    expect(r.ok && r.set.weight_kg).toBe(61.235);
  });

  it("a mile is 1609 meters", () => {
    const r = sinSetToHevy(sin({ distance: 1, distanceUnit: "mi", distanceM: 1609.344, durationS: 600 }), { hevyType: "distance_duration", modality: "distance_duration", rule: null });
    expect(r.ok && r.set.distance_meters).toBe(1609);
    expect(r.ok && r.notices).toEqual(["distance_rounded"]);
  });

  it("0.4 m sends 0, with distance_rounded", () => {
    const r = sinSetToHevy(sin({ weightKg: 20, weight: 20, weightUnit: "kg", distance: 0.4, distanceUnit: "m", distanceM: 0.4 }), { hevyType: "short_distance_weight", modality: "weight_distance", rule: null });
    expect(r.ok && r.set.distance_meters).toBe(0);
    expect(r.ok && r.notices).toEqual(["distance_rounded"]);
  });

  it("calories_as_reps writes the calories as reps", () => {
    const r = sinSetToHevy(sin({ calories: 25 }), { hevyType: "reps_only", modality: "calories", rule: "calories_as_reps" });
    expect(r.ok && r.set).toEqual({ type: "normal", reps: 25, rpe: null });
  });

  it("set types map back one to one", () => {
    const types = (["warmup", "working", "drop", "failure"] as const).map((setType) => {
      const r = sinSetToHevy(sin({ setType, reps: 5, weightKg: 60, weight: 60, weightUnit: "kg" }), { hevyType: "weight_reps", modality: "weight_reps", rule: null });
      return r.ok ? r.set.type : null;
    });
    expect(types).toEqual(["warmup", "normal", "dropset", "failure"]);
  });

  it("a set missing a required measure is not sent", () => {
    expect(sinSetToHevy(sin({ reps: 5 }), { hevyType: "weight_reps", modality: "weight_reps", rule: null })).toEqual({ ok: false });
  });
});

describe("19.0 AC9 — RPE in the export", () => {
  const send = (rpe: number) => sinSetToHevy(sin({ reps: 5, weightKg: 60, weight: 60, weightUnit: "kg", rpe }), { hevyType: "weight_reps", modality: "weight_reps", rule: null });

  it("5 is dropped, with rpe_dropped", () => {
    const r = send(5);
    expect(r.ok && [r.set.rpe, r.notices]).toEqual([null, ["rpe_dropped"]]);
  });

  it("7.3 rounds to 7.5, with rpe_rounded", () => {
    const r = send(7.3);
    expect(r.ok && [r.set.rpe, r.notices]).toEqual([7.5, ["rpe_rounded"]]);
  });

  it("8 stays 8, no notice", () => {
    const r = send(8);
    expect(r.ok && [r.set.rpe, r.notices]).toEqual([8, []]);
  });
});
