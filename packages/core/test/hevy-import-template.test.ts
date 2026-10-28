import { describe, expect, it } from "vitest";
import {
  CreateExerciseSchema,
  HEVY_TYPE_VALUES,
  HevyTemplatePageSchema,
  HevyTemplateSchema,
  canonicalModalityForHevyType,
  exerciseFromHevyTemplate,
  type HevyTemplate,
} from "../src/index.js";
import { jsonFixture } from "./fixtures/hevy/import/context.js";

const base = HevyTemplateSchema.parse(jsonFixture("../template"));
const page = HevyTemplatePageSchema.parse(jsonFixture("../templates-page"));
const template = (o: Partial<HevyTemplate> = {}): HevyTemplate => ({ ...base, ...o });
const echo = template({ title: "Echo Bike (Calories)", type: "reps_only", primary_muscle_group: "cardio", secondary_muscle_groups: [], equipment: "machine" });
const assisted = template({ title: "Assisted Dip", type: "bodyweight_assisted_reps", primary_muscle_group: "triceps", secondary_muscle_groups: ["chest"], equipment: "machine" });

describe("19.1 AC12 — exerciseFromHevyTemplate: modality and rule", () => {
  it("reps_only titled with (Calories), any case, is calories under calories_as_reps", () => {
    expect(exerciseFromHevyTemplate(echo)).toMatchObject({ input: { modality: "calories" }, suggestedRule: "calories_as_reps" });
    expect(exerciseFromHevyTemplate(template({ title: "Row (CALORIES)", type: "reps_only" }))).toMatchObject({
      input: { modality: "calories" },
      suggestedRule: "calories_as_reps",
    });
  });

  it("reps_only without it is bodyweight_reps, no rule", () => {
    expect(exerciseFromHevyTemplate(template({ title: "Pull Up", type: "reps_only" }))).toMatchObject({
      input: { modality: "bodyweight_reps" },
      suggestedRule: null,
    });
  });

  it("bodyweight_assisted_reps is bodyweight_reps under assist_weight_ignored", () => {
    expect(exerciseFromHevyTemplate(assisted)).toMatchObject({ input: { modality: "bodyweight_reps" }, suggestedRule: "assist_weight_ignored" });
  });

  it.each(HEVY_TYPE_VALUES.filter((t) => t !== "reps_only" && t !== "bodyweight_assisted_reps"))("%s reads through the type table", (type) => {
    expect(exerciseFromHevyTemplate(template({ type }))).toMatchObject({
      input: { modality: canonicalModalityForHevyType(type) },
      suggestedRule: null,
    });
  });

  it("a type SIN does not support gives null", () => {
    expect(exerciseFromHevyTemplate(template({ type: null }))).toBeNull();
  });
});

describe("19.1 AC12 — name", () => {
  it("a 130-character title is cut to 120", () => {
    expect(exerciseFromHevyTemplate(template({ title: "x".repeat(130) }))!.input.name).toHaveLength(120);
  });

  it("control characters are removed and the name trimmed", () => {
    expect(exerciseFromHevyTemplate(template({ title: " Bench\u0007 Press " }))!.input.name).toBe("Bench Press");
  });

  it("a blank title still gives a valid name", () => {
    expect(exerciseFromHevyTemplate(template({ title: " \u0001 " }))!.input.name).toBe("Hevy exercise");
  });
});

describe("19.1 AC12 — muscles and equipment", () => {
  it("secondary muscles are mapped, deduplicated, without the primary, at most 4", () => {
    const r = exerciseFromHevyTemplate(
      template({ primary_muscle_group: "chest", secondary_muscle_groups: ["chest", "chest", "triceps", "biceps", "lats", "glutes", "quadriceps"] }),
    )!;
    expect([r.input.primaryMuscleId, r.input.secondaryMuscleIds]).toEqual(["chest", ["triceps", "biceps", "lats", "glutes"]]);
  });

  it("two Hevy muscles that map to one SIN muscle count once", () => {
    const r = exerciseFromHevyTemplate(template({ primary_muscle_group: "lats", secondary_muscle_groups: ["upper_back", "lower_back"] }))!;
    expect(r.input.secondaryMuscleIds).toEqual(["back"]);
  });

  it("an unmatched or missing muscle or equipment is null or dropped", () => {
    const r = exerciseFromHevyTemplate(
      template({ primary_muscle_group: "forearms", secondary_muscle_groups: ["neck", "nonsense", "triceps"], equipment: "resistance_band" }),
    )!;
    expect([r.input.primaryMuscleId, r.input.secondaryMuscleIds, r.input.equipmentId]).toEqual([null, ["triceps"], null]);
    const bare = exerciseFromHevyTemplate(template({ primary_muscle_group: null, secondary_muscle_groups: null, equipment: undefined }))!;
    expect([bare.input.primaryMuscleId, bare.input.secondaryMuscleIds, bare.input.equipmentId]).toEqual([null, [], null]);
  });

  it("the real-shaped template maps through the tables", () => {
    expect(exerciseFromHevyTemplate(base)).toEqual({
      input: { name: "Bench Press (Barbell)", modality: "weight_reps", primaryMuscleId: "chest", secondaryMuscleIds: ["triceps", "shoulders"], equipmentId: "barbell" },
      suggestedRule: null,
    });
  });
});

describe("19.1 AC12 — every output parses with CreateExerciseSchema", () => {
  it.each([base, echo, assisted, ...page.exercise_templates].map((t) => [t.title, t] as const))("%s", (_title, t) => {
    const r = exerciseFromHevyTemplate(t);
    if (r === null) return;
    expect(CreateExerciseSchema.safeParse(r.input).error?.issues ?? []).toEqual([]);
  });
});
