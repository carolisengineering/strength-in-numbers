import { describe, expect, it } from "vitest";
import { routineIsOneOffSql } from "../../src/repositories/workout.prisma.js";

describe("Minor 41 — the one-off SQL fragment takes only the workout aliases in use", () => {
  it.each([
    ["w", 'EXISTS (SELECT 1 FROM "routine" r WHERE r.id = w.routine_id AND r.one_off_until IS NOT NULL)'],
    ['"workout"', 'EXISTS (SELECT 1 FROM "routine" r WHERE r.id = "workout".routine_id AND r.one_off_until IS NOT NULL)'],
  ] as const)("%s", (ref, sql) => {
    expect(routineIsOneOffSql(ref).sql).toBe(sql);
  });

  it("any other alias does not compile", () => {
    // @ts-expect-error — only "w" and '"workout"' are accepted.
    expect(() => routineIsOneOffSql("wk")).not.toThrow();
  });
});
