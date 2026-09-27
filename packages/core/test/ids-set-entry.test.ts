import { describe, expect, expectTypeOf, it } from "vitest";
import {
  isSetEntryId,
  parseSetEntryId,
  SetEntryIdSchema,
  type SetEntryId,
  type WorkoutExerciseId,
} from "../src/index.js";

describe("AC17 — SetEntryId brand quartet", () => {
  it("parseSetEntryId accepts a UUID and throws on malformed input", () => {
    expect(() => parseSetEntryId("018fcb3e-3b8a-7d6e-9c1a-000000000010")).not.toThrow();
    expect(() => parseSetEntryId("not-a-uuid")).toThrow();
  });
  it("isSetEntryId is a type guard; SetEntryIdSchema parses", () => {
    expect(isSetEntryId("018fcb3e-3b8a-7d6e-9c1a-000000000010")).toBe(true);
    expect(isSetEntryId("nope")).toBe(false);
    expect(SetEntryIdSchema.safeParse("018fcb3e-3b8a-7d6e-9c1a-000000000010").success).toBe(true);
  });
  it("a raw string is not a SetEntryId, and a SetEntryId is not a WorkoutExerciseId", () => {
    expectTypeOf<string>().not.toMatchTypeOf<SetEntryId>();
    expectTypeOf<SetEntryId>().not.toMatchTypeOf<WorkoutExerciseId>();
  });
});
