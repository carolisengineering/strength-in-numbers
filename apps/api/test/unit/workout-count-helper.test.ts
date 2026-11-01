import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../src/repositories/workout.prisma.ts", import.meta.url)), "utf8");

describe("Minor 287 — one exercise-count statement", () => {
  it('workout.prisma.ts writes `count(*)::int AS n FROM "workout_exercise"` once, in countExercises', () => {
    expect(source.match(/count\(\*\)::int AS n FROM "workout_exercise"/g)).toHaveLength(1);
    expect(source).toContain("async function countExercises(");
  });
});
