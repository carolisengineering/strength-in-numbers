import {
  HEVY_TYPE_VALUES,
  MAPPING_CSV_HEADER,
  MODALITY_VALUES,
  hevyPairingProblem,
  normalizeExportAs,
  parseMappingCsv,
  type HevyMapping,
  type HevyTemplate,
  type HevyType,
} from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { applyRule, fixableRule, resolveLines, willBeRemoved } from "./resolveLines";

const tpl = (id: string, title: string, type: HevyType | null = "weight_reps"): HevyTemplate =>
  ({ id, title, type, is_custom: false, primary_muscle_group: null, secondary_muscle_groups: [], equipment: null }) as HevyTemplate;

const BENCH = makeExercise({ id: exerciseId(1), name: "Bench Press" });
const ROW = makeExercise({ id: exerciseId(2), name: "Row Erg", modality: "calories" });
const PLANK = makeExercise({ id: exerciseId(3), name: "Plank", modality: "duration" });
const OLD = makeExercise({ id: exerciseId(4), name: "Old Curl", isActive: false });
const DIP = makeExercise({ id: exerciseId(5), name: "Dip", modality: "bodyweight_reps" });
const TWIN_A = makeExercise({ id: exerciseId(6), name: "Lat Pulldown" });
const TWIN_B = makeExercise({ id: exerciseId(7), name: "lat  pulldown", ownerUserId: "0192a1b2-0000-7000-8000-0000000000aa" });
const CATALOG = [BENCH, ROW, PLANK, OLD, DIP, TWIN_A, TWIN_B];

const TEMPLATES = [
  tpl("T-BENCH", "Bench Press (Barbell)"),
  tpl("T-ROW", "Echo Bike (calories)", "reps_only"),
  tpl("T-ASSIST", "Assisted Dip", "bodyweight_assisted_reps"),
  tpl("T-SQUAT", "Squat"),
  tpl("T-DUP1", "Shrug"),
  tpl("T-DUP2", "Shrug"),
  tpl("T-WARM", "Warmup", "reps_only"),
  tpl("T-SKIP", "Stretching", "duration"),
];

/** A file with these data rows (line 1 is the header, so row i is line i + 2). */
const file = (...rows: string[]) => parseMappingCsv([MAPPING_CSV_HEADER, ...rows].join("\r\n"));
const resolve = (...rows: string[]) => resolveLines(file(...rows), { templates: TEMPLATES, catalog: CATALOG });

describe("20.0 AC19 — resolving", () => {
  it("the Hevy id wins; else the exact title; else not found", () => {
    const r = resolve(
      `exercise,T-BENCH,,${BENCH.id},,,`,
      `exercise,,Squat,${BENCH.id},,,`,
      `exercise,,squat,${BENCH.id},,,`,
      `exercise,T-NONE,,${BENCH.id},,,`,
    );
    expect(r.pairs.map((p) => p.hevyTemplateId)).toEqual(["T-BENCH", "T-SQUAT"]);
    expect(r.leftOut).toEqual([
      { line: 4, hevyWritten: "squat", sinWritten: BENCH.id, reason: "hevy_not_found" },
      { line: 5, hevyWritten: "T-NONE", sinWritten: BENCH.id, reason: "hevy_not_found" },
    ]);
  });

  it("an id and title that disagree resolve by the id, with a notice", () => {
    const r = resolve(`exercise,T-BENCH,Squat,${BENCH.id},,,`);
    expect(r.pairs[0]).toMatchObject({ hevyTemplateId: "T-BENCH", hevyTitle: "Bench Press (Barbell)" });
    expect(r.notices).toEqual([{ kind: "id_title_disagree", line: 2 }]);
  });

  it("two templates with one title are ambiguous, never guessed (Review Focus 2)", () => {
    const r = resolve(`exercise,,Shrug,${BENCH.id},,,`);
    expect(r.pairs).toEqual([]);
    expect(r.leftOut).toEqual([{ line: 2, hevyWritten: "Shrug", sinWritten: BENCH.id, reason: "hevy_ambiguous" }]);
  });

  it("the SIN side: a visible id, a retired id, an unknown id falling back to the name, a name, two equal names, none", () => {
    const r = resolve(
      `exercise,T-BENCH,,${BENCH.id},,,`,
      `exercise,T-SQUAT,,${OLD.id},,,`,
      `exercise,T-DUP1,,${exerciseId(99)},bench press,,`,
      `exercise,T-DUP2,,,Lat Pulldown,,`,
      `exercise,T-SKIP,,,Nothing Like It,,`,
    );
    expect(r.pairs.map((p) => [p.hevyTemplateId, p.exerciseId])).toEqual([
      ["T-BENCH", BENCH.id],
      ["T-DUP1", BENCH.id],
    ]);
    expect(r.leftOut).toEqual([
      { line: 3, hevyWritten: "T-SQUAT", sinWritten: OLD.id, reason: "retired" },
      { line: 5, hevyWritten: "T-DUP2", sinWritten: "Lat Pulldown", reason: "sin_ambiguous" },
      { line: 6, hevyWritten: "T-SKIP", sinWritten: "Nothing Like It", reason: "sin_not_found" },
    ]);
  });
});

describe("20.0 AC20 — checking", () => {
  it("calories and assisted pairings with no rule need one; a mismatch is left out with both labels", () => {
    const r = resolve(`exercise,T-ROW,,${ROW.id},,,`, `exercise,T-ASSIST,,${DIP.id},,,`, `exercise,T-BENCH,,${PLANK.id},,,`);
    expect(r.pairs).toEqual([]);
    expect(r.needsRule.map((n) => [n.line, n.templateId, n.rule])).toEqual([
      [2, "T-ROW", "calories_as_reps"],
      [3, "T-ASSIST", "assist_weight_ignored"],
    ]);
    expect(r.leftOut).toEqual([
      { line: 4, hevyWritten: "T-BENCH", sinWritten: PLANK.id, reason: "type_mismatch", hevyTypeLabel: "Weight & reps", modalityLabel: "Duration" },
    ]);
  });

  it("applyRule moves the line into pairs with its rule", () => {
    const r = applyRule(resolve(`exercise,T-ROW,,${ROW.id},,,`), "T-ROW");
    expect(r.needsRule).toEqual([]);
    expect(r.pairs).toEqual([
      { hevyTemplateId: "T-ROW", hevyTitle: "Echo Bike (calories)", hevyType: "reps_only", role: "exercise", exerciseId: ROW.id, measureRule: "calories_as_reps", exportAs: true },
    ]);
  });

  it("a rule written in the file is kept when it fits", () => {
    expect(resolve(`exercise,T-ROW,,${ROW.id},,calories_as_reps,`).pairs[0]).toMatchObject({ measureRule: "calories_as_reps" });
  });

  it("fixableRule agrees with 19.0's pairing rules for every type and modality", () => {
    for (const h of HEVY_TYPE_VALUES) {
      for (const m of MODALITY_VALUES) {
        const fix = fixableRule(h, m);
        const plain = hevyPairingProblem(h, m, null);
        if (plain === null) expect(fix).toBeNull();
        else if (fix !== null) expect(hevyPairingProblem(h, m, fix)).toBeNull();
      }
    }
    expect(fixableRule("reps_only", "calories")).toBe("calories_as_reps");
    expect(fixableRule("bodyweight_assisted_reps", "bodyweight_reps")).toBe("assist_weight_ignored");
    expect(fixableRule("weight_reps", "duration")).toBeNull();
  });
});

describe("20.0 §6.4 — kinds and export_as", () => {
  it("skip, placeholders and section lines", () => {
    const r = resolve("skip,T-SKIP,,,,,", "placeholder,T-WARM,,,,warmup,", "placeholder,,No Such Marker,,,workout,", "section,,,,Finisher,notes_on_first,");
    expect(r.pairs).toEqual([
      { hevyTemplateId: "T-SKIP", hevyTitle: "Stretching", hevyType: "duration", role: "skip", exerciseId: null, measureRule: null, exportAs: false },
      { hevyTemplateId: "T-WARM", hevyTitle: "Warmup", hevyType: "reps_only", role: "warmup_placeholder", exerciseId: null, measureRule: null, exportAs: false },
    ]);
    expect(r.placeholders).toEqual({ warmup: true, workout: false });
    expect(r.notices).toContainEqual({ kind: "placeholder_not_found", which: "workout" });
    expect(r.sectionRules).toEqual([{ name: "Finisher", treatment: "notes_on_first" }]);
  });

  it("export_as: none marked picks the first; yes twice keeps the first with a notice; output is already normalized", () => {
    const none = resolve(`exercise,T-BENCH,,${BENCH.id},,,`, `exercise,T-SQUAT,,${BENCH.id},,,no`);
    expect(none.pairs.map((p) => p.exportAs)).toEqual([true, false]);
    const twice = resolve(`exercise,T-BENCH,,${BENCH.id},,,yes`, `exercise,T-SQUAT,,${BENCH.id},,,yes`);
    expect(twice.pairs.map((p) => p.exportAs)).toEqual([true, false]);
    expect(twice.notices).toEqual([{ kind: "export_as_twice", line: 3 }]);
    expect(normalizeExportAs(twice.pairs)).toEqual(twice.pairs);
  });

  it("the same template twice keeps the first line and leaves the second out as a duplicate", () => {
    const r = resolve(`exercise,T-BENCH,,${BENCH.id},,,`, "skip,T-BENCH,,,,,");
    expect(r.pairs.map((p) => p.role)).toEqual(["exercise"]);
    expect(r.leftOut).toEqual([{ line: 3, hevyWritten: "T-BENCH", sinWritten: "", reason: "duplicate" }]);
  });
});

describe("20.0 AC21 — will be removed", () => {
  it("lists the current pairs the file lacks (Review Focus 4)", () => {
    const current: HevyMapping = {
      pairs: [
        { hevyTemplateId: "T-BENCH", hevyTitle: "Bench Press (Barbell)", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: true },
        { hevyTemplateId: "T-X", hevyTitle: "Made on Pairings", hevyType: "weight_reps", role: "exercise", exerciseId: BENCH.id, exerciseActive: true, measureRule: null, exportAs: false },
      ],
      sectionRules: [],
    };
    const next = resolve(`exercise,T-BENCH,,${BENCH.id},,,`).pairs;
    expect(willBeRemoved(current, next).map((p) => p.hevyTemplateId)).toEqual(["T-X"]);
  });
});
