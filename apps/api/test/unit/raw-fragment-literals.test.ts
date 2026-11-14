import { describe, expect, it } from "vitest";
import { exerciseColumns } from "../../src/repositories/exercise.prisma.js";
import { roundTimesJson } from "../../src/repositories/section-timer-columns.js";
import { workoutSectionsJson } from "../../src/repositories/workout.prisma.js";

/**
 * Minor 394: three `UNSAFE_ALLOWLIST` reasons say "callers pass a column literal". The parameter types make that
 * true: a `string` reference must not compile (each `@ts-expect-error` fails the typecheck if a type widens again).
 */
const anyRef: string = "x";

describe("minor 394 — the allow-listed Prisma.raw builders take only literal references", () => {
  it("exerciseColumns: no alias, or the literal e", () => {
    expect(exerciseColumns().sql).not.toContain(".");
    expect(exerciseColumns("e").sql).toContain("e.id");
    void (() => {
      // @ts-expect-error a non-literal reference must not compile
      exerciseColumns(anyRef);
    });
  });

  it("roundTimesJson: s.id or \"workout_section\".id", () => {
    expect(roundTimesJson("s.id").sql).toContain("= s.id");
    expect(roundTimesJson('"workout_section".id').sql).toContain('= "workout_section".id');
    void (() => {
      // @ts-expect-error a non-literal reference must not compile
      roundTimesJson(anyRef);
    });
  });

  it("workoutSectionsJson: w.id or \"workout\".id", () => {
    expect(workoutSectionsJson("w.id").sql).toContain("= w.id");
    expect(workoutSectionsJson('"workout".id').sql).toContain('= "workout".id');
    void (() => {
      // @ts-expect-error a non-literal reference must not compile
      workoutSectionsJson(anyRef);
    });
  });
});
