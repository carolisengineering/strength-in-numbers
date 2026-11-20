import { describe, expect, it } from "vitest";

// Raw source of every non-test module under src, except the tolerant wrappers themselves.
const sources = import.meta.glob(
  ["../../**/*.ts", "../../**/*.tsx", "!../../**/*.test.ts", "!../../**/*.test.tsx", "!../../test/**", "!./tolerantRecords.ts"],
  { query: "?raw", import: "default", eager: true },
) as Record<string, string>;

/** The core schemas that parse a record list strictly; `TolerantUpdatedWorkoutSchema` doesn't match (no word boundary). */
const STRICT_RECORD_SCHEMAS = /\b(?:PersonalRecordSchema|PersonalRecordsResponseSchema|UpdatedWorkoutSchema)\b/;

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
});
