import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RoutineItemSchema, WorkoutExerciseSchema } from "../src/index.js";

const ROOTS = ["../src", "../../../apps/web/src"].map((p) => fileURLToPath(new URL(p, import.meta.url)));
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(p) ? [p] : [];
  });
}

describe("AC24 — sets / plannedSets are required, never defaulted", () => {
  it("a RoutineItem without sets and a WorkoutExercise without plannedSets fail safeParse", () => {
    const item = { id: "018fcb3e-3b8a-7d6e-9c1a-000000000001", position: 0, exerciseId: "018fcb3e-3b8a-7d6e-9c1a-000000000002", targetSets: null, targetRepsLow: null, targetRepsHigh: null, targetRpe: null, restSeconds: null, supersetGroup: null, notes: null };
    expect(RoutineItemSchema.safeParse(item).success).toBe(false);
    expect(RoutineItemSchema.safeParse({ ...item, sets: [] }).success).toBe(true);
    expect(Object.keys(WorkoutExerciseSchema.shape)).toContain("plannedSets");
    expect(WorkoutExerciseSchema.shape.plannedSets.safeParse(undefined).success).toBe(false);
  });

  it("no .default( / .catch( attached to sets or plannedSets in core or web source", () => {
    for (const f of ROOTS.flatMap(files)) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/\b(sets|plannedSets)\s*:\s*z\.[^,;\n]*\.(default|catch)\(/);
    }
  });
});
