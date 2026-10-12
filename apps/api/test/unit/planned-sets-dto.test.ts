import { describe, expect, it } from "vitest";
import { RoutineSchema, WorkoutDetailSchema } from "@sin/core";
import { buildTestApp } from "../helpers/build-test-app.js";

describe("AC28 — sets / plannedSets flow through the shared response schemas", () => {
  it("RoutineSchema items and WorkoutDetailSchema exercises carry the fields", () => {
    expect(Object.keys(RoutineSchema.shape.items.element.shape)).toContain("sets");
    expect(Object.keys(WorkoutDetailSchema.shape.exercises.element.shape)).toContain("plannedSets");
  });
  it("the app still assembles", async () => {
    const { app } = await buildTestApp();
    await app.ready();
  });
});
