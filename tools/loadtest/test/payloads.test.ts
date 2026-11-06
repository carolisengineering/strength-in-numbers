import { describe, expect, it } from "vitest";
import { CreateSetSchema, CreateWorkoutSchema, RoutineCreateSchema, UpdateWorkoutSchema } from "@sin/core";
import { createRng, uuidFrom } from "../src/plan/rng.ts";
import { finishBody, setBody, startBody } from "../src/plan/payloads.ts";
import { SEEDED_ROUTINE_KEYS, seededRoutine } from "../src/plan/routine.ts";

const ROUTINE_ID = "0190f6c2-1111-7000-8000-000000000001";
const NOW = new Date("2026-11-06T10:00:00.000Z");

describe("AC4 — every generated request body is valid", () => {
  it("1,000 start bodies pass CreateWorkoutSchema", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const result = CreateWorkoutSchema.safeParse(startBody(ROUTINE_ID, createRng(seed), NOW));
      expect(result.success, `seed ${seed}`).toBe(true);
    }
  });

  it("1,000 weighted and 1,000 bodyweight set bodies pass CreateSetSchema", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      expect(CreateSetSchema.safeParse(setBody(createRng(seed), 60)).success, `seed ${seed}`).toBe(true);
      expect(CreateSetSchema.safeParse(setBody(createRng(seed), null)).success, `seed ${seed}`).toBe(true);
    }
  });

  it("1,000 finish bodies pass UpdateWorkoutSchema", () => {
    for (let seed = 1; seed <= 1000; seed += 1) {
      const at = new Date(NOW.getTime() + seed * 60_000);
      expect(UpdateWorkoutSchema.safeParse(finishBody(at)).success, `seed ${seed}`).toBe(true);
    }
  });

  it("the routine body passes RoutineCreateSchema", () => {
    const ids = Object.fromEntries(SEEDED_ROUTINE_KEYS.map((k, i) => [k, uuidFrom(createRng(i + 1))]));
    expect(RoutineCreateSchema.safeParse(seededRoutine(ids)).success).toBe(true);
  });

  it("a corrupted body is rejected by the same check (the test can fail)", () => {
    const corrupted = { ...setBody(createRng(1), 60), reps: -1 };
    expect(CreateSetSchema.safeParse(corrupted).success).toBe(false);
  });

  it("set bodies are working, complete, in kg, and carry weight only when planned", () => {
    expect(setBody(createRng(3), 60)).toMatchObject({ setType: "working", isComplete: true, weightUnit: "kg" });
    const bodyweight = setBody(createRng(3), null) as Record<string, unknown>;
    expect(bodyweight).not.toHaveProperty("weight");
    expect(bodyweight).not.toHaveProperty("weightUnit");
  });

  it("the same seed gives the same body; client ids are lowercase UUIDs", () => {
    expect(startBody(ROUTINE_ID, createRng(7), NOW)).toEqual(startBody(ROUTINE_ID, createRng(7), NOW));
    const id = (startBody(ROUTINE_ID, createRng(7), NOW) as { clientGeneratedId: string }).clientGeneratedId;
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
