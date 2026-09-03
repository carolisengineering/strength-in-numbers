import { describe, expect, it } from "vitest";
import { brandId, isUserId, parseUserId } from "../src/ids.js";

const UUID_V7 = "018f9c8e-7b1a-7c2d-9e3f-4a5b6c7d8e9f";
const UUID_V4 = "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d";

describe("AC5 — branded ids (runtime behaviour)", () => {
  it("parseUserId accepts a well-formed UUID and returns the string value", () => {
    expect(parseUserId(UUID_V7)).toBe(UUID_V7);
  });

  it("parseUserId accepts a v4 UUID too — ids are minted app-side, fixtures use v4", () => {
    expect(parseUserId(UUID_V4)).toBe(UUID_V4);
  });

  it("parseUserId is lenient about the version/variant nibbles (z.guid, not z.uuid)", () => {
    // nil UUID, and a well-shaped id with a non-RFC-9562 version nibble (0)
    // and variant nibble (c) — both must still parse.
    expect(parseUserId("00000000-0000-0000-0000-000000000000")).toBe(
      "00000000-0000-0000-0000-000000000000",
    );
    expect(parseUserId("9b1deb4d-3b7d-0bad-cbdd-2b0d7b3dcb6d")).toBe(
      "9b1deb4d-3b7d-0bad-cbdd-2b0d7b3dcb6d",
    );
  });

  it("parseUserId throws on a malformed id", () => {
    expect(() => parseUserId("not-a-uuid")).toThrow();
    expect(() => parseUserId("")).toThrow();
    expect(() => parseUserId(UUID_V7.toUpperCase() + "x")).toThrow();
  });

  it("isUserId is a boolean guard, never throws", () => {
    expect(isUserId(UUID_V7)).toBe(true);
    expect(isUserId("nope")).toBe(false);
  });

  it("brandId helper produces an independent brand each call", () => {
    const { parse: parseExerciseId, is: isExerciseId } = brandId("ExerciseId");
    expect(parseExerciseId(UUID_V7)).toBe(UUID_V7);
    expect(isExerciseId(UUID_V7)).toBe(true);
    expect(() => parseExerciseId("bad")).toThrow();
  });

  it("brandId schema composes into a larger Zod object", () => {
    const { schema } = brandId("WorkoutId");
    const parsed = schema.safeParse(UUID_V7);
    expect(parsed.success).toBe(true);
  });
});
