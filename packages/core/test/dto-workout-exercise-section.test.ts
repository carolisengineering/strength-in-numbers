import { describe, expect, it } from "vitest";
import { NOT_WITH_POSITION, UpdateWorkoutExerciseSchema } from "../src/index.js";

const SECTION = "018fcb3e-3b8a-7d6e-9c1a-0000000b0001";

describe("09.4 AC11 — UpdateWorkoutExerciseSchema.sectionId", () => {
  it.each([
    [{ sectionId: SECTION }, true],
    [{ sectionId: null }, true],
    [{ sectionId: SECTION, notes: "n", supersetGroup: 3 }, true],
    [{ position: 1 }, true],
    [{ sectionId: "nope" }, false],
  ] as [unknown, boolean][])("%j → success %s", (body, ok) => {
    expect(UpdateWorkoutExerciseSchema.safeParse(body).success).toBe(ok);
  });

  it("a malformed id is an issue on sectionId", () => {
    const r = UpdateWorkoutExerciseSchema.safeParse({ sectionId: "nope" });
    expect(r.error!.issues.map((i) => i.path.join("."))).toEqual(["sectionId"]);
  });

  it.each([[{ sectionId: SECTION, position: 1 }], [{ sectionId: null, position: 2 }]])(
    "%j → one issue at sectionId with NOT_WITH_POSITION (Review Focus 3)",
    (body) => {
      const r = UpdateWorkoutExerciseSchema.safeParse(body);
      expect(r.success).toBe(false);
      expect(r.error!.issues.map((i) => [i.path.join("."), i.message])).toEqual([["sectionId", NOT_WITH_POSITION]]);
    },
  );

  it("NOT_WITH_POSITION is the static message", () => {
    expect(NOT_WITH_POSITION).toBe("can't be combined with position");
  });
});
