import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { RoutineCreateSchema } from "@sin/core";
import { REST_MAX_S, REST_MIN_S, SET_WORK_S } from "../src/plan/constants.ts";
import { SEEDED_ROUTINE_KEYS, SEEDED_ROUTINE_NAME, seededRoutine, seededRoutineSets } from "../src/plan/routine.ts";

type CatalogRow = { catalogKey: string; modality: string };
const catalog = JSON.parse(
  readFileSync(new URL("../../../apps/api/prisma/catalog/exercises.json", import.meta.url), "utf8"),
) as CatalogRow[];
const modalityOf = new Map(catalog.map((e) => [e.catalogKey, e.modality]));

const fakeIds = Object.fromEntries(
  SEEDED_ROUTINE_KEYS.map((key, i) => [key, `0190f6c2-0000-7000-8000-${String(i).padStart(12, "0")}`]),
);

describe("AC5 — the seeded routine is representative", () => {
  const body = seededRoutine(fakeIds);

  it("has 5–6 items with 3–4 working planned sets each", () => {
    expect(body.items.length).toBeGreaterThanOrEqual(5);
    expect(body.items.length).toBeLessThanOrEqual(6);
    for (const item of body.items) {
      expect(item.sets!.length).toBeGreaterThanOrEqual(3);
      expect(item.sets!.length).toBeLessThanOrEqual(4);
      for (const s of item.sets!) expect(s.setType).toBe("working");
    }
    expect(seededRoutineSets()).toEqual(body.items.map((i) => i.sets!.length));
  });

  it("is mostly weight-and-reps, from keys in the seeded catalog", () => {
    for (const key of SEEDED_ROUTINE_KEYS) expect(modalityOf.has(key), key).toBe(true);
    const weightReps = SEEDED_ROUTINE_KEYS.filter((k) => modalityOf.get(k) === "weight_reps");
    expect(weightReps.length).toBeGreaterThanOrEqual(4);
  });

  it("has exactly one superset of exactly two items", () => {
    const groups = body.items.map((i) => i.supersetGroup ?? null).filter((g) => g !== null);
    expect(new Set(groups).size).toBe(1);
    expect(groups).toHaveLength(2);
  });

  it("passes the routine create schema and is named for the seed lookup", () => {
    expect(RoutineCreateSchema.safeParse(body).success).toBe(true);
    expect(body.name).toBe(SEEDED_ROUTINE_NAME);
  });

  it("takes roughly 45–60 minutes at real pace", () => {
    const sets = body.items.reduce((n, i) => n + i.sets!.length, 0);
    const minutes = (sets * (SET_WORK_S + (REST_MIN_S + REST_MAX_S) / 2)) / 60;
    expect(minutes).toBeGreaterThanOrEqual(45);
    expect(minutes).toBeLessThanOrEqual(60);
  });
});
