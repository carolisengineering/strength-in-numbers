import { describe, expect, it, vi } from "vitest";
import type { HevyMapping, HevyRoutine, HevyTemplate, HevyWorkout } from "@sin/core";

import type * as ImportNeeds from "./importNeeds";
import { pairingNeeds, templatesUsed } from "./importNeeds";
import { importSession, initialImportState, isSummaryStale, nextStepAfterRead, nextStepAfterRoutines, type ImportState } from "./importSession";
import type { HevyRead } from "./readHevy";

vi.mock("./importNeeds", async (importOriginal) => {
  const actual = await importOriginal<typeof ImportNeeds>();
  return { ...actual, templatesUsed: vi.fn(actual.templatesUsed) };
});

const template = (id: string, title = id): HevyTemplate => ({ id, title, type: "weight_reps", is_custom: false });
const workout = (id: string, ...templates: string[]): HevyWorkout => ({
  id,
  title: id,
  start_time: "2026-07-01T09:00:00Z",
  end_time: "2026-07-01T10:00:00Z",
  exercises: templates.map((t, index) => ({ index, title: t, exercise_template_id: t, sets: [{ type: "normal", reps: 5 }] })),
});
const routine = (id: string, ...templates: string[]): HevyRoutine => ({
  id,
  title: id,
  folder_id: null,
  exercises: templates.map((t, index) => ({ index, title: t, exercise_template_id: t, sets: [] })),
});
const readOf = (workouts: HevyWorkout[], routines: HevyRoutine[], templates: HevyTemplate[]): HevyRead => ({
  workoutCount: workouts.length,
  templates: new Map(templates.map((t) => [t.id, t])),
  folders: [],
  routines,
  workouts: new Map(workouts.map((w) => [w.id, w])),
});
const paired = (...ids: string[]): HevyMapping => ({
  pairs: ids.map((id) => ({ hevyTemplateId: id, hevyTitle: id, hevyType: "weight_reps", role: "skip", exerciseId: null, exerciseActive: null, measureRule: null, exportAs: false })),
  sectionRules: [],
});
const catalog = { visible: [], synced: true };

const reading = (generation = 1): ImportState => importSession(initialImportState, { type: "start", generation });

describe("20.1 AC3 / AC5 — reducer", () => {
  it("start goes to reading under the new generation", () => {
    expect(reading(4)).toMatchObject({ step: "reading", generation: 4, read: null });
  });

  it("a result from an older generation is ignored", () => {
    const state = reading(2);
    const late = importSession(state, { type: "readDone", generation: 1, read: readOf([], [], []) });
    expect(late).toBe(state);
    expect(importSession(state, { type: "readProgress", generation: 1, progress: { stage: "workouts", page: 1, pageCount: 2 } })).toBe(state);
  });

  it("a failed stage stays on reading with the error", () => {
    const failed = importSession(reading(), { type: "readFailed", generation: 1, failure: { kind: "stage", stage: "workouts", cause: "other", partial: {} } });
    expect(failed).toMatchObject({ step: "reading", readError: { kind: "stage", stage: "workouts" } });
  });

  it("cancel goes back to preflight with nothing kept, and a later reply of the canceled read is ignored", () => {
    const canceled = importSession(reading(1), { type: "cancel" });
    expect(canceled).toMatchObject({ step: "preflight", read: null, generation: 2 });
    expect(importSession(canceled, { type: "readDone", generation: 1, read: readOf([], [], []) })).toBe(canceled);
  });

  it("readDone goes to routines when Hevy has routines, else to preparing", () => {
    const withRoutines = importSession(reading(), { type: "readDone", generation: 1, read: readOf([], [routine("r1")], []) });
    expect(withRoutines.step).toBe("routines");
    const without = importSession(reading(), { type: "readDone", generation: 1, read: readOf([], [], []) });
    expect(without.step).toBe("preparing");
    expect(nextStepAfterRead({ ...without, read: null }).step).toBe("preparing");
  });

  it("after routines: markers, names, or checking", () => {
    const read = readOf([workout("w1", "A", "WU")], [routine("r1", "WO")], [template("A"), template("WU", "Warmup"), template("WO", "workout")]);
    const base: ImportState = { ...initialImportState, read };
    expect(nextStepAfterRoutines(base, { mapping: paired(), catalog }).step).toBe("markers");
    // The workout marker is used only by the routine: once picked, it is missing too.
    expect(nextStepAfterRoutines({ ...base, markersSkipped: true }, { mapping: paired("WU"), catalog }).step).toBe("names");
    expect(nextStepAfterRoutines(base, { mapping: paired("WU", "A"), catalog }).step).toBe("checking");
    expect(nextStepAfterRoutines({ ...base, picks: { picked: new Set(["r1"]) } }, { mapping: paired("WU", "A"), catalog }).step).toBe("markers");
    expect(nextStepAfterRoutines({ ...base, markersSkipped: true }, { mapping: paired(), catalog }).step).toBe("names");
    expect(nextStepAfterRoutines({ ...initialImportState }, { mapping: paired(), catalog }).step).toBe("checking");
  });

  it("Minor 247 — names comes with its needs, from one walk of the template use", () => {
    const read = readOf([workout("w1", "A", "WU")], [routine("r1", "WO")], [template("A"), template("WU", "Warmup"), template("WO", "workout")]);
    const state: ImportState = { ...initialImportState, read, markersSkipped: true };
    const ctx = { mapping: paired("WU"), catalog };
    vi.mocked(templatesUsed).mockClear();
    const next = nextStepAfterRoutines(state, ctx);
    expect(templatesUsed).toHaveBeenCalledTimes(1);
    expect(next).toEqual({ step: "names", needs: pairingNeeds(templatesUsed(read, []), read.templates, ctx.mapping, ctx.catalog) });
  });

  it("back keeps the read and the picks", () => {
    const read = readOf([], [routine("r1")], []);
    const summary: ImportState = { ...initialImportState, step: "summary", read, picks: { picked: new Set(["r1"]) } };
    const back = importSession(summary, { type: "back", to: "routines" });
    expect(back.step).toBe("routines");
    expect(back.read).toBe(read);
    expect([...back.picks.picked]).toEqual(["r1"]);
  });

  it("the names save moves to checking and counts what it created; a failure returns to the cards", () => {
    const names: ImportState = { ...initialImportState, step: "names" };
    const saving = importSession(names, { type: "namesSaving" });
    expect(saving.step).toBe("saving_names");
    expect(importSession(saving, { type: "namesFailed", message: "No." })).toMatchObject({ step: "names", namesError: "No." });
    expect(importSession({ ...saving, exercisesCreated: 1 }, { type: "namesSaved", created: 3 })).toMatchObject({ step: "checking", exercisesCreated: 3 });
  });

  it("an invalid card makes decisions null", () => {
    const names: ImportState = { ...initialImportState, step: "names" };
    expect(importSession(names, { type: "namesValidity", valid: false, decisions: [] }).decisions).toBeNull();
    expect(importSession(names, { type: "namesValidity", valid: true, decisions: [] }).decisions).toEqual([]);
  });

  it("checking records the mapping it ran against and lands on the summary", () => {
    const mapping = paired();
    const checking = importSession({ ...initialImportState, generation: 3 }, { type: "checkStart", generation: 4, mapping, unreadable: ["u1"] });
    expect(checking).toMatchObject({ step: "checking", summaryMapping: mapping, unreadable: ["u1"] });
    expect(importSession(checking, { type: "checked", generation: 3, results: [] })).toBe(checking);
    expect(importSession(checking, { type: "checked", generation: 4, results: [] }).step).toBe("summary");
  });
});

describe("20.1 AC28 — the stale rule", () => {
  it("is stale only when a summary exists and the mapping is another object", () => {
    const mapping = paired();
    const summary: ImportState = { ...initialImportState, results: [], summaryMapping: mapping };
    expect(isSummaryStale(summary, mapping)).toBe(false);
    expect(isSummaryStale(summary, paired())).toBe(true);
    expect(isSummaryStale({ ...summary, results: null }, paired())).toBe(false);
  });

  it("final review C1: every way into checking drops the old summary, so a new dry run starts", () => {
    const old: ImportState = { ...initialImportState, step: "routines", results: [], summaryError: "failed", checkProgress: { done: 1, total: 2 } };
    for (const next of [importSession(old, { type: "goto", step: "checking" }), importSession({ ...old, step: "saving_names" }, { type: "namesSaved", created: 0 })]) {
      expect(next).toMatchObject({ step: "checking", results: null, summaryError: null, checkProgress: null });
    }
    expect(importSession(old, { type: "goto", step: "names" }).results).toEqual([]);
  });

  it("recheck runs the check again from nothing", () => {
    const summary: ImportState = { ...initialImportState, step: "summary", results: [], summaryError: null };
    expect(importSession(summary, { type: "recheck" })).toMatchObject({ step: "checking", results: null });
  });
});
