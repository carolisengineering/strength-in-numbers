import { describe, expect, it } from "vitest";

// Raw source of every non-test module under src, except the tolerant wrappers themselves.
const sources = import.meta.glob(
  ["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx", "!../../test/**", "!./tolerantRecords.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/**
 * A strict record-list parse: the core schemas that parse one (`TolerantUpdatedWorkoutSchema` doesn't match, no word
 * boundary), and, since minor 682, one built in the web: `z.enum(RECORD_TYPE_VALUES)`, or a `records` / `newRecords`
 * key whose value is a zod schema (a plain `records:` / `newRecords:` object key elsewhere has no `z.` and passes).
 */
const STRICT_RECORD_SCHEMAS =
  /\b(?:PersonalRecordSchema|PersonalRecordsResponseSchema|UpdatedWorkoutSchema)\b|z\.enum\(\s*RECORD_TYPE_VALUES|\b(?:newRecords|records)\s*:\s*z\./;

describe("07.5 AC3 — every web parse of a record list is tolerant", () => {
  it("found the two clients that parse record lists", () => {
    expect(Object.keys(sources)).toEqual(expect.arrayContaining(["./recordsClient.ts", "../workouts/workoutClient.ts"]));
    expect(sources["./recordsClient.ts"]).toContain("TolerantPersonalRecordsResponseSchema");
    expect(sources["../workouts/workoutClient.ts"]).toContain("TolerantUpdatedWorkoutSchema");
  });

  it("no other module names a strict record-list schema", () => {
    const offenders = Object.entries(sources)
      .filter(([, source]) => STRICT_RECORD_SCHEMAS.test(source))
      .map(([path]) => path)
      .sort();
    expect(offenders).toEqual([]);
  });

  it("minor 682: a record schema built by hand is caught", () => {
    for (const sample of ["x: z.enum(RECORD_TYPE_VALUES)", "WorkoutSchema.extend({ newRecords: z.array(S) })"]) {
      expect(sample, sample).toMatch(STRICT_RECORD_SCHEMAS);
    }
  });
});
