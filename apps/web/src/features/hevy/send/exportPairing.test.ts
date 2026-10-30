import { describe, expect, it } from "vitest";
import { HevyPairInputSchema, type HevyMapping, type HevyTemplate, type UnmappedExercise } from "@sin/core";

import { EXERCISE_A, EXERCISE_B } from "../../../test/hevySendFakes";
import { acceptableTemplates, allowedHevyTypes, canContinue, createDraftFor, initialExportCards, leftOut, upsertsFor, type ExportCard } from "./exportPairing";

const template = (id: string, type: HevyTemplate["type"], title = `T ${id}`): HevyTemplate => ({ id, title, type, is_custom: false });
const bench: UnmappedExercise = { exerciseId: EXERCISE_A, name: "Bench Press", modality: "weight_reps" };
const bike: UnmappedExercise = { exerciseId: EXERCISE_B, name: "Echo Bike", modality: "calories" };
const empty: HevyMapping = { pairs: [], sectionRules: [] };

describe("20.2 AC13 — export pairing model", () => {
  it("acceptable templates follow hevyPairingProblem; Calories takes only reps_only; a null type never", () => {
    const list = [template("a", "weight_reps"), template("b", "bodyweight_reps"), template("c", "duration"), template("d", "reps_only"), template("e", null)];
    expect(acceptableTemplates(list, "weight_reps").map((t) => t.id)).toEqual(expect.arrayContaining(["a"]));
    expect(acceptableTemplates(list, "weight_reps").map((t) => t.id)).not.toContain("c");
    expect(acceptableTemplates(list, "calories").map((t) => t.id)).toEqual(["d"]);
    expect(acceptableTemplates(list, "weight_reps").map((t) => t.id)).not.toContain("e");
    expect(allowedHevyTypes("calories")).toEqual(["reps_only"]);
  });

  it("initialExportCards drops an exercise paired since the build, also through its lineage root", () => {
    const paired: HevyMapping = {
      pairs: [{ hevyTemplateId: "T1", hevyTitle: "Bench", hevyType: "weight_reps", role: "exercise", exerciseId: "root-1", exerciseActive: true, measureRule: null, exportAs: true }],
      sectionRules: [],
    };
    const cards = initialExportCards([bench, bike], paired, (id) => (id === EXERCISE_A ? "root-1" : id));
    expect(cards.map((c) => c.exercise.exerciseId)).toEqual([EXERCISE_B]);
    expect(initialExportCards([bench, bike], empty, (id) => id)).toHaveLength(2);
  });

  it("canContinue needs every card chosen, and a create created", () => {
    const cards: ExportCard[] = initialExportCards([bench, bike], empty, (id) => id);
    expect(canContinue(cards)).toBe(false);
    const draft = createDraftFor(bike, undefined);
    const chosen: ExportCard[] = [
      { ...cards[0]!, choice: { kind: "pick", template: template("a", "weight_reps", "Bench Press (Barbell)") } },
      { ...cards[1]!, choice: { kind: "create", draft } },
    ];
    expect(canContinue(chosen)).toBe(false);
    chosen[1] = { ...cards[1]!, choice: { kind: "create", draft, created: { id: "123" } } };
    expect(canContinue(chosen)).toBe(true);
  });

  it("upsertsFor writes exact pair bodies (exportAs, the calories rule), each a valid pair input; leftOut lists the leaves", () => {
    const cards: ExportCard[] = [
      { exercise: bench, choice: { kind: "pick", template: template("a", "weight_reps", "Bench Press (Barbell)") } },
      { exercise: bike, choice: { kind: "create", draft: createDraftFor(bike, undefined), created: { id: "123" } } },
      { exercise: { exerciseId: "e0000000-0000-4000-8000-00000000000c", name: "Sled", modality: "weight_distance" }, choice: { kind: "leave" } },
    ];
    const upserts = upsertsFor(cards);
    expect(upserts).toEqual([
      { hevyTemplateId: "a", hevyTitle: "Bench Press (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: EXERCISE_A, measureRule: null, exportAs: true },
      { hevyTemplateId: "123", hevyTitle: "Echo Bike (calories)", hevyType: "reps_only", role: "exercise", exerciseId: EXERCISE_B, measureRule: "calories_as_reps", exportAs: true },
    ]);
    for (const u of upserts) expect(HevyPairInputSchema.safeParse(u).success).toBe(true);
    expect([...leftOut(cards)]).toEqual(["e0000000-0000-4000-8000-00000000000c"]);
  });

  it("createDraftFor: the SIN name (+ (calories)), the type for the modality, the row's muscles and equipment", () => {
    expect(createDraftFor(bike, undefined)).toEqual({ title: "Echo Bike (calories)", hevyType: "reps_only", primaryMuscle: null, otherMuscles: [], equipment: null });
    const row = { primaryMuscleId: "chest", secondaryMuscleIds: ["triceps"], equipmentId: "barbell" };
    expect(createDraftFor(bench, row)).toEqual({ title: "Bench Press", hevyType: "weight_reps", primaryMuscle: "chest", otherMuscles: ["triceps"], equipment: "barbell" });
  });
});
