import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("../../src/repositories/workout.prisma.ts", import.meta.url)), "utf8");

describe("Minor 287 — one exercise-count statement", () => {
  it("workout.prisma.ts counts workout_exercise in two places: countExercises and countAndLastSection's subquery", () => {
    // Code review: the combined read (minor 54) can't call the helper, so it is the one other copy; a third fails here.
    expect(source.match(/count\(\*\)::int(?: AS n)? FROM "workout_exercise"/g)).toHaveLength(2);
    expect(source).toContain("async function countExercises(");
  });
});
