import type { HevyPairInput, Modality } from "@sin/core";
import { describe, expect, it } from "vitest";
import { validateMappingInput, type VisibleExercise } from "../../src/hevy/mappingValidation.js";

const EX = "0192a1b2-0000-7000-8000-000000000101";
const EX2 = "0192a1b2-0000-7000-8000-000000000102";
const RETIRED = "0192a1b2-0000-7000-8000-000000000103";
const TITLE = "Secret Hevy Title";

const visible = new Map<string, VisibleExercise>([
  [EX, { modality: "weight_reps" as Modality, isActive: true }],
  [EX2, { modality: "calories" as Modality, isActive: true }],
  [RETIRED, { modality: "weight_reps" as Modality, isActive: false }],
]);
const pair = (o: Partial<HevyPairInput> = {}): HevyPairInput => ({
  hevyTemplateId: "T1",
  hevyTitle: TITLE,
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId: EX,
  measureRule: null,
  exportAs: true,
  ...o,
});
const replace = (pairs: HevyPairInput[], rules: { name: string; treatment: "notes_on_first" }[] = []) =>
  validateMappingInput(pairs, rules, visible, { mode: "replace" });

describe("19.0 AC23 — mapping validation", () => {
  it("a valid mapping has no errors", () => {
    expect(replace([pair(), pair({ hevyTemplateId: "S", role: "skip", exerciseId: null, exportAs: false, hevyType: null })])).toEqual([]);
  });

  it.each([
    ["an exercise not visible to the caller", pair({ exerciseId: "0192a1b2-0000-7000-8000-000000000999" })],
    ["a retired exercise", pair({ exerciseId: RETIRED })],
  ])("%s: pairs.0.exerciseId", (_l, p) => {
    expect(replace([p]).map((e) => e.path)).toEqual(["pairs.0.exerciseId"]);
  });

  it("a skip with an exerciseId: pairs.0.exerciseId", () => {
    expect(replace([pair({ role: "skip", exportAs: false })]).map((e) => e.path)).toEqual(["pairs.0.exerciseId"]);
  });

  it("a pairing problem: pairs.0.measureRule", () => {
    expect(replace([pair({ hevyType: "duration" })]).map((e) => e.path)).toEqual(["pairs.0.measureRule"]);
    expect(replace([pair({ exerciseId: EX2, hevyType: "reps_only" })]).map((e) => e.path)).toEqual(["pairs.0.measureRule"]);
  });

  it("no Hevy type on anything but a skip: pairs.0.hevyType", () => {
    expect(replace([pair({ hevyType: null })]).map((e) => e.path)).toEqual(["pairs.0.hevyType"]);
  });

  it("a duplicate template id: pairs.1.hevyTemplateId", () => {
    expect(replace([pair(), pair({ exportAs: false })]).map((e) => e.path)).toEqual(["pairs.1.hevyTemplateId"]);
  });

  it("two exportAs for one exercise are refused in a replace and in a patch's upserts (AC24 applies AC23; final review ruling)", () => {
    const twice = [pair(), pair({ hevyTemplateId: "T2" })];
    expect(replace(twice).map((e) => e.path)).toEqual(["pairs.1.exportAs"]);
    expect(validateMappingInput(twice, [], visible, { mode: "patch", prefix: "upsert" }).map((e) => e.path)).toEqual(["upsert.1.exportAs"]);
  });

  it("exportAs or a rule on a marker", () => {
    const marker = pair({ role: "warmup_placeholder", exerciseId: null });
    expect(replace([marker]).map((e) => e.path)).toEqual(["pairs.0.exportAs"]);
    expect(replace([{ ...marker, exportAs: false, measureRule: "calories_as_reps" }]).map((e) => e.path)).toEqual(["pairs.0.measureRule"]);
  });

  it("two warm-up markers: pairs.1.role", () => {
    const marker = (id: string) => pair({ hevyTemplateId: id, role: "warmup_placeholder", exerciseId: null, exportAs: false });
    expect(replace([marker("W1"), marker("W2")]).map((e) => e.path)).toEqual(["pairs.1.role"]);
  });

  it("a duplicate section rule name, whatever its spacing and case: sectionRules.1.name", () => {
    expect(replace([], [{ name: " Accessory", treatment: "notes_on_first" }, { name: "accessory", treatment: "notes_on_first" }]).map((e) => e.path)).toEqual([
      "sectionRules.1.name",
    ]);
  });

  it("paths take the given prefix (a patch's upsert list)", () => {
    expect(validateMappingInput([pair({ exerciseId: RETIRED })], [], visible, { mode: "patch", prefix: "upsert" }).map((e) => e.path)).toEqual([
      "upsert.0.exerciseId",
    ]);
  });

  // 19.0 AC36: the new @sin/core schemas are probed by packages/core/test/static-issue-messages.test.ts through the barrel.
  it("19.0 AC36 — no message carries a Hevy title, an id or a value", () => {
    const errors = replace([
      pair({ exerciseId: RETIRED }),
      pair({ hevyType: "duration" }),
      pair({ role: "skip", exportAs: false }),
    ]);
    expect(errors.length).toBeGreaterThan(0);
    const text = JSON.stringify(errors.map((e) => e.message));
    expect(text).not.toContain(TITLE);
    expect(text).not.toContain(RETIRED);
    expect(text).not.toContain("T1");
  });
});
