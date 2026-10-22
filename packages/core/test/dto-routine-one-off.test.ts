import { describe, expect, it } from "vitest";
import { ROUTINE_ONE_OFF_DAYS, RoutineCreateSchema, RoutineSchema, RoutineWriteSchema } from "../src/dto/routine.js";
import { UpdatedWorkoutSchema, WorkoutDetailSchema, WorkoutSchema, WorkoutSummarySchema } from "../src/dto/workout.js";

const EX = "018fcb3e-3b8a-7d6e-9c1a-000000000010";
const body = (over: Record<string, unknown> = {}) => ({ name: "Push A", items: [{ exerciseId: EX }], ...over });
const issues = (r: { success: boolean; error?: { issues: { path: PropertyKey[]; code: string }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => ({ path: i.path.join("."), code: i.code }));

describe("09.3 AC5 — RoutineCreateSchema", () => {
  it("holds the 14-day constant", () => {
    expect(ROUTINE_ONE_OFF_DAYS).toBe(14);
  });

  it("accepts oneOff: true and an absent oneOff", () => {
    expect(RoutineCreateSchema.safeParse(body({ oneOff: true })).data?.oneOff).toBe(true);
    const plain = RoutineCreateSchema.safeParse(body());
    expect(plain.success).toBe(true);
    expect(plain.data).not.toHaveProperty("oneOff");
  });

  it.each([false, null, "true", 1])("rejects oneOff: %j on oneOff", (value) => {
    expect(issues(RoutineCreateSchema.safeParse(body({ oneOff: value }))).map((i) => i.path)).toEqual(["oneOff"]);
  });

  it("a client can never send the expiry (strict)", () => {
    expect(issues(RoutineCreateSchema.safeParse(body({ oneOffUntil: "2026-11-02T00:00:00Z" })))).toEqual([
      { path: "", code: "unrecognized_keys" },
    ]);
  });

  it("the document rules still apply", () => {
    const r = RoutineCreateSchema.safeParse(body({ oneOff: true, items: [{ exerciseId: EX, targetRepsLow: 8 }] }));
    expect(issues(r).map((i) => i.path)).toEqual(["items.0.targetRepsHigh"]);
  });
});

describe("09.3 AC5 — RoutineWriteSchema stays closed", () => {
  it("rejects oneOff and oneOffUntil as unknown keys", () => {
    expect(issues(RoutineWriteSchema.safeParse(body({ oneOff: true })))).toEqual([{ path: "", code: "unrecognized_keys" }]);
    expect(issues(RoutineWriteSchema.safeParse(body({ oneOffUntil: "2026-11-02T00:00:00Z" })))).toEqual([
      { path: "", code: "unrecognized_keys" },
    ]);
  });

  it("still accepts today's body", () => {
    expect(RoutineWriteSchema.safeParse(body()).success).toBe(true);
  });
});

describe("09.3 AC1 — the new response fields are required and placed", () => {
  const routine = {
    id: "018fcb3e-3b8a-7d6e-9c1a-000000000001",
    name: "Push A",
    notes: null,
    sections: [],
    items: [],
    createdAt: "2026-10-22T10:00:00.000Z",
    updatedAt: "2026-10-22T10:00:00.000Z",
  };

  it("Routine.oneOffUntil is required-nullable and the last key", () => {
    expect(RoutineSchema.safeParse(routine).success).toBe(false);
    expect(RoutineSchema.safeParse({ ...routine, oneOffUntil: null }).success).toBe(true);
    expect(RoutineSchema.safeParse({ ...routine, oneOffUntil: "2026-11-05T10:00:00.000Z" }).success).toBe(true);
    expect(Object.keys(RoutineSchema.shape).at(-1)).toBe("oneOffUntil");
  });

  it("WorkoutDetail.routineIsOneOff is a required boolean, on the detail only", () => {
    const shape: Record<string, { safeParse: (v: unknown) => { success: boolean } }> = WorkoutDetailSchema.shape;
    expect(shape.routineIsOneOff?.safeParse(undefined).success).toBe(false);
    expect(shape.routineIsOneOff?.safeParse(null).success).toBe(false);
    expect(shape.routineIsOneOff?.safeParse(true).success).toBe(true);
    expect("routineIsOneOff" in WorkoutSchema.shape).toBe(false);
    expect("routineIsOneOff" in UpdatedWorkoutSchema.shape).toBe(false);
    expect("routineIsOneOff" in WorkoutSummarySchema.shape).toBe(false);
  });
});
