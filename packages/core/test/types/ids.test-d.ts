import { describe, expectTypeOf, it } from "vitest";
import {
  brandId,
  parseExerciseId,
  parseUserId,
  type ExerciseId,
  type UserId,
} from "../../src/ids.js";

describe("AC5 — branded ids (type level)", () => {
  it("a raw string is not assignable to UserId", () => {
    const raw = "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f";
    // @ts-expect-error — must go through parseUserId first
    const bad: UserId = raw;
    void bad;
  });

  it("parseUserId returns the branded type", () => {
    expectTypeOf(parseUserId).returns.toEqualTypeOf<UserId>();
  });

  it("UserId is assignable to string (it is one at runtime)", () => {
    expectTypeOf<UserId>().toMatchTypeOf<string>();
  });

  it("two brands from the helper are not interchangeable", () => {
    const { parse: parseWorkoutId } = brandId("WorkoutId");
    const w = parseWorkoutId("018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f");
    // @ts-expect-error — WorkoutId is not a UserId
    const u: UserId = w;
    void u;
  });
});

describe("AC9 — ExerciseId brand (type level)", () => {
  const UUID = "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f";

  it("a raw string is not assignable to ExerciseId", () => {
    // @ts-expect-error — must go through parseExerciseId first
    const bad: ExerciseId = UUID;
    void bad;
  });

  it("a UserId is not an ExerciseId", () => {
    const u = parseUserId(UUID);
    // @ts-expect-error — different brand
    const e: ExerciseId = u;
    void e;
  });

  it("parseExerciseId returns the branded type", () => {
    expectTypeOf(parseExerciseId).returns.toEqualTypeOf<ExerciseId>();
  });

  it("ExerciseId is assignable to string (it is one at runtime)", () => {
    expectTypeOf<ExerciseId>().toMatchTypeOf<string>();
  });
});
