import { describe, expect, it } from "vitest";
import type { HevyMapping, HevyPair, HevyRoutine, HevySet, HevyTemplate, HevyWorkout } from "@sin/core";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { inferHevyType, markersMissing, missingTemplates, pairingNeeds, templatesUsed, usageText } from "./importNeeds";
import type { HevyRead } from "./readHevy";

const template = (id: string, title = id): HevyTemplate => ({ id, title, type: "weight_reps", is_custom: false });
const hevyWorkout = (id: string, ...templateIds: string[]): HevyWorkout => ({
  id,
  title: id,
  start_time: "2026-07-01T09:00:00Z",
  end_time: "2026-07-01T10:00:00Z",
  exercises: templateIds.map((t, index) => ({ index, title: `Title ${t}`, exercise_template_id: t, sets: [{ type: "normal", weight_kg: 50, reps: 5 }] })),
});
const hevyRoutine = (id: string, ...templateIds: string[]): HevyRoutine => ({
  id,
  title: id,
  folder_id: null,
  exercises: templateIds.map((t, index) => ({ index, title: `Title ${t}`, exercise_template_id: t, sets: [] })),
});
const readOf = (workouts: HevyWorkout[], templates: HevyTemplate[], routines: HevyRoutine[] = []): HevyRead => ({
  workoutCount: workouts.length,
  templates: new Map(templates.map((t) => [t.id, t])),
  folders: [],
  routines,
  workouts: new Map(workouts.map((w) => [w.id, w])),
});
const pair = (over: Partial<HevyPair> & { hevyTemplateId: string }): HevyPair => ({
  hevyTitle: over.hevyTemplateId,
  hevyType: "weight_reps",
  role: "exercise",
  exerciseId: exerciseId(1),
  exerciseActive: true,
  measureRule: null,
  exportAs: false,
  ...over,
});
const mapping = (...pairs: HevyPair[]): HevyMapping => ({ pairs, sectionRules: [] });
const catalog = { visible: [makeExercise({ id: exerciseId(1) })], synced: true };

describe("20.1 AC8 — markers", () => {
  const read = readOf([hevyWorkout("w1", "WU", "B")], [template("WU", " WarmUp "), template("B", "Bench"), template("WS", "Warmup Sets"), template("WO", "workout")]);

  it("a used Warmup template with no marker pair is missing", () => {
    expect(markersMissing(templatesUsed(read, []), read.templates, mapping())).toEqual({ warmup: "WU", workout: null });
  });

  it("is not missing once the mapping has a pair of that role", () => {
    const m = mapping(pair({ hevyTemplateId: "WU", role: "warmup_placeholder", exerciseId: null, exerciseActive: null }));
    expect(markersMissing(templatesUsed(read, []), read.templates, m)).toEqual({ warmup: null, workout: null });
  });

  it("counts a marker only a picked routine uses", () => {
    const withRoutine = readOf([hevyWorkout("w1", "B")], read.templates.size ? [...read.templates.values()] : [], [hevyRoutine("r1", "WO")]);
    expect(markersMissing(templatesUsed(withRoutine, []), withRoutine.templates, mapping()).workout).toBeNull();
    expect(markersMissing(templatesUsed(withRoutine, withRoutine.routines), withRoutine.templates, mapping()).workout).toBe("WO");
  });

  it("Warmup Sets is not a marker", () => {
    const r = readOf([hevyWorkout("w1", "WS")], [template("WS", "Warmup Sets")]);
    expect(markersMissing(templatesUsed(r, []), r.templates, mapping())).toEqual({ warmup: null, workout: null });
  });
});

describe("20.1 AC9 — needs", () => {
  const workouts = Array.from({ length: 41 }, (_, i) => hevyWorkout(`w${i}`, "U", ...(i < 3 ? ["S"] : [])));
  const read = readOf(
    [...workouts, hevyWorkout("x1", "K", "M", "P", "R", "G")],
    ["U", "S", "K", "M", "P", "R", "G"].map((id) => template(id)),
    [hevyRoutine("r1", "U"), hevyRoutine("r2", "Z")],
  );
  const m = mapping(
    pair({ hevyTemplateId: "K", role: "skip", exerciseId: null, exerciseActive: null }),
    pair({ hevyTemplateId: "M", role: "workout_placeholder", exerciseId: null, exerciseActive: null }),
    pair({ hevyTemplateId: "P" }),
    pair({ hevyTemplateId: "R", exerciseActive: false }),
    pair({ hevyTemplateId: "G", exerciseId: exerciseId(9) }),
  );

  it("lists unpaired and retired templates by usage, with the usage line", () => {
    const used = templatesUsed(read, [read.routines[0]!]);
    const needs = pairingNeeds(used, read.templates, m, catalog);
    expect(needs.map((n) => n.template.id)).toEqual(["U", "S", "G", "R"]);
    expect(needs[0]!.context).toEqual({ workouts: 41, routines: 1 });
    expect(usageText(needs[0]!.context!)).toBe("41 workouts, 1 routine");
    expect(usageText({ workouts: 1, routines: 0 })).toBe("1 workout");
    expect(usageText({ workouts: 0, routines: 2 })).toBe("2 routines");
  });

  it("before the first catalog sync, a pair whose row is absent is not a need", () => {
    const used = templatesUsed(read, []);
    const ids = pairingNeeds(used, read.templates, m, { visible: [], synced: false }).map((n) => n.template.id);
    expect(ids).toContain("R");
    expect(ids).not.toContain("G");
    expect(ids).not.toContain("P");
  });

  it("a routine that isn't picked adds no usage", () => {
    const used = templatesUsed(read, []);
    expect(used.get("U")).toMatchObject({ workouts: 41, routines: 0 });
    expect(used.has("Z")).toBe(false);
  });

  it("zero needs is []", () => {
    const r = readOf([hevyWorkout("w1", "P")], [template("P")]);
    expect(pairingNeeds(templatesUsed(r, []), r.templates, m, catalog)).toEqual([]);
  });
});

describe("20.1 AC32 — templates Hevy no longer lists", () => {
  it("a used template absent from the list is missing and becomes a need from the workouts' title", () => {
    const r = readOf([hevyWorkout("w1", "GONE", "B"), hevyWorkout("w2", "GONE")], [template("B")]);
    const used = templatesUsed(r, []);
    expect(missingTemplates(used, r.templates)).toEqual(["GONE"]);
    const need = pairingNeeds(used, r.templates, mapping(pair({ hevyTemplateId: "B" })), catalog);
    expect(need).toEqual([
      { template: { id: "GONE", title: "Title GONE", type: "weight_reps", is_custom: true }, context: { workouts: 2, routines: 0 }, missing: true },
    ]);
  });

  const set = (over: Partial<HevySet>): HevySet => ({ type: "normal", ...over });
  it.each([
    [[set({ weight_kg: 50, reps: 5 })], "weight_reps"],
    [[set({ reps: 10 })], "reps_only"],
    [[set({ duration_seconds: 60 })], "duration"],
    [[set({ distance_meters: 400, duration_seconds: 90 })], "distance_duration"],
    [[set({ weight_kg: 20, duration_seconds: 30 })], "weight_duration"],
    [[set({ weight_kg: 24, distance_meters: 40 })], "short_distance_weight"],
    [[set({}), set({ weight_kg: null, reps: null })], "reps_only"],
    [[set({ weight_kg: 50 }), set({ reps: 5 })], "weight_reps"],
  ] as const)("inferHevyType(%j) is %s", (sets, type) => {
    expect(inferHevyType([...sets])).toBe(type);
  });
});

describe("Minor 247 — sets are kept only for templates Hevy no longer lists", () => {
  it("a listed template's use carries no sets; an unlisted one keeps every set", () => {
    const read = readOf([hevyWorkout("w1", "A", "GONE"), hevyWorkout("w2", "A", "GONE")], [template("A")]);
    const used = templatesUsed(read, []);
    expect(used.get("A")!.sets).toEqual([]);
    expect(used.get("GONE")!.sets).toHaveLength(2);
    expect(used.get("A")!.workouts).toBe(2);
  });
});
