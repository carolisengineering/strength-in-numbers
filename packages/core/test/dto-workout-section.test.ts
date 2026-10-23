import { describe, expect, it } from "vitest";
import { CreateWorkoutSectionSchema, UpdateWorkoutSectionSchema } from "../src/index.js";

const paths = (r: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  r.success ? [] : r.error!.issues.map((i) => i.path.join("."));

describe("09.4 AC4 — CreateWorkoutSectionSchema field matrix", () => {
  it.each([
    [{ name: "Warm-up" }, []],
    [{ name: "  Warm-up  " }, []],
    [{ name: "x".repeat(40) }, []],
    [{ name: "x".repeat(41) }, ["name"]],
    [{ name: "" }, ["name"]],
    [{ name: "   " }, ["name"]], // Review Focus 1: trim runs before min(1)
    [{ name: "Warm\nup" }, ["name"]], // Review Focus 5
    [{ name: "A", notes: null }, []],
    [{ name: "A", notes: "" }, ["notes"]],
    [{ name: "A", notes: "n".repeat(2000) }, []],
    [{ name: "A", notes: "n".repeat(2001) }, ["notes"]],
    [{ name: "A", notes: "EMOM\t10 min\r\nrest" }, []], // Review Focus 5
    [{ name: "A", notes: "a\u0007b" }, ["notes"]],
    [{}, ["name"]],
    [{ name: "", notes: "" }, ["name", "notes"]], // collected
  ] as [unknown, string[]][])("%j → %j", (body, expected) => {
    expect(paths(CreateWorkoutSectionSchema.safeParse(body))).toEqual(expected);
  });

  it("trims the name", () => {
    expect(CreateWorkoutSectionSchema.parse({ name: "  Warm-up  " }).name).toBe("Warm-up");
  });

  it.each(["position", "addedInWorkout", "id"])("unknown key %s is rejected", (key) => {
    expect(CreateWorkoutSectionSchema.safeParse({ name: "A", [key]: 0 }).success).toBe(false);
  });
});

describe("09.4 AC4 — UpdateWorkoutSectionSchema field matrix", () => {
  it.each([
    [{}, []],
    [{ notes: null }, []],
    [{ name: "B" }, []],
    [{ name: "   " }, ["name"]],
    [{ notes: "" }, ["notes"]],
  ] as [unknown, string[]][])("%j → %j", (body, expected) => {
    expect(paths(UpdateWorkoutSectionSchema.safeParse(body))).toEqual(expected);
  });

  it.each(["position", "addedInWorkout", "id"])("unknown key %s is rejected", (key) => {
    expect(UpdateWorkoutSectionSchema.safeParse({ [key]: 1 }).success).toBe(false);
  });
});
