import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { HevyRoutinePageSchema, RoutineWriteSchema, translateHevyRoutine, type HevyPair, type HevyRoutine, type HevyRoutineTranslation, type HevyImportResult, type RoutineWrite } from "@sin/core";

import { ApiError } from "../../../api";
import { exerciseId } from "../../../test/catalogFixtures";
import { hevyFixtures } from "../../../test/hevyFixtures";
import { ROUTINE_GAP_MS } from "./constants";
import { createRoutines, type RoutineOutcome } from "./createRoutines";
import { importSession, initialImportState, type ImportState } from "./importSession";

beforeEach(() => observability.reportError.mockReset());

const fixture = HevyRoutinePageSchema.parse(hevyFixtures.routinesPage()).routines;
const items = fixture[0]!.exercises;
const named = (id: string, title: string): HevyRoutine => ({ id, title, folder_id: null, exercises: items });
const pairs = new Map<string, HevyPair>(
  items.map((e) => [
    e.exercise_template_id,
    { hevyTemplateId: e.exercise_template_id, hevyTitle: e.title, hevyType: "weight_reps", role: "exercise", exerciseId: exerciseId(1), exerciseActive: true, measureRule: null, exportAs: false },
  ]),
);
const exercises = new Map([[exerciseId(1), { name: "Bench Press", modality: "weight_reps" as const, active: true, rootId: exerciseId(1) }]]);
const translate = (r: HevyRoutine): HevyRoutineTranslation => translateHevyRoutine(r, { pairs, exercises, unit: "kg" });

const problem = (status: number, slug: string) => new ApiError({ status, type: `https://api.strengthinnumbers.app/problems/${slug}`, title: slug, requestId: "r" });
const network = () => new ApiError({ status: 0, type: "about:blank", title: "Network", requestId: "r", isNetworkError: true });

function harness(fail: (name: string, n: number) => Error | null = () => null, over: Partial<{ translate: typeof translate }> = {}) {
  const sent: RoutineWrite[] = [];
  const waits: number[] = [];
  const progress: string[] = [];
  const deps = {
    create: async (body: RoutineWrite) => {
      sent.push(body);
      const err = fail(body.name, sent.length);
      if (err) throw err;
      return { id: `r${sent.length}` };
    },
    translate: over.translate ?? translate,
    sleep: async (ms: number) => {
      waits.push(ms);
    },
    signal: new AbortController().signal,
    onProgress: (done: number, total: number) => progress.push(`Creating routines… ${done} of ${total}`),
  };
  return { deps, sent, waits, progress };
}

const kinds = (outcomes: RoutineOutcome[]) => outcomes.map((o) => o.kind);

describe("20.1 AC23 — routines", () => {
  it("creates them in order, 3 s apart, with progress, never oneOff, each body a valid routine", async () => {
    const h = harness();
    const outcomes = await createRoutines([named("a", "Push A"), named("b", "Pull A"), named("c", "Legs")], h.deps);
    expect(kinds(outcomes)).toEqual(["created", "created", "created"]);
    expect(h.sent.map((b) => b.name)).toEqual(["Push A", "Pull A", "Legs"]);
    expect(h.waits).toEqual([ROUTINE_GAP_MS, ROUTINE_GAP_MS]);
    expect(h.progress).toContain("Creating routines… 2 of 3");
    for (const body of h.sent) {
      expect(body).not.toHaveProperty("oneOff");
      expect(RoutineWriteSchema.safeParse(body).success).toBe(true);
    }
    expect(outcomes.map((o) => [o.hevyRoutineId, o.name])).toEqual([
      ["a", "Push A"],
      ["b", "Pull A"],
      ["c", "Legs"],
    ]);
  });

  it("409 routine-name-taken is already there, not an error", async () => {
    const h = harness((name) => (name === "Pull A" ? problem(409, "routine-name-taken") : null));
    expect(kinds(await createRoutines([named("a", "Push A"), named("b", "Pull A")], h.deps))).toEqual(["created", "exists"]);
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("409 routine-limit on the second of four marks it and every later one not created, and stops", async () => {
    const h = harness((_, n) => (n === 2 ? problem(409, "routine-limit") : null));
    const outcomes = await createRoutines([named("a", "A"), named("b", "B"), named("c", "C"), named("d", "D")], h.deps);
    expect(kinds(outcomes)).toEqual(["created", "limit_not_created", "limit_not_created", "limit_not_created"]);
    expect(h.sent).toHaveLength(2);
  });

  it("code review 3: after the limit, a later routine that can't be created anyway keeps its own reason", async () => {
    const h = harness((_, n) => (n === 2 ? problem(409, "routine-limit") : null), {
      translate: (r) => (r.id === "d" ? { ok: false, reason: "no_items", unpaired: [] } : translate(r)),
    });
    const outcomes = await createRoutines([named("a", "A"), named("b", "B"), named("c", "C"), named("d", "D")], h.deps);
    expect(kinds(outcomes)).toEqual(["created", "limit_not_created", "limit_not_created", "no_items"]);
    expect(h.sent).toHaveLength(2);
  });

  it("an unpaired translation is listed and never sent (defended)", async () => {
    const h = harness(() => null, { translate: () => ({ ok: false, reason: "unpaired", unpaired: ["T9"] }) });
    expect(kinds(await createRoutines([named("a", "A")], h.deps))).toEqual(["unpaired"]);
    expect(h.sent).toEqual([]);
  });

  it("a no_items translation is nothing to import: never sent, not an error", async () => {
    const h = harness(() => null, { translate: (r) => (r.id === "a" ? { ok: false, reason: "no_items", unpaired: [] } : translate(r)) });
    expect(kinds(await createRoutines([named("a", "A"), named("b", "B")], h.deps))).toEqual(["no_items", "created"]);
    expect(h.sent.map((b) => b.name)).toEqual(["B"]);
    expect(h.waits).toEqual([]);
  });

  it("a 422 is invalid; a network error is failed and the next routine is still tried", async () => {
    const h = harness((name) => (name === "A" ? problem(422, "validation-error") : name === "B" ? network() : null));
    expect(kinds(await createRoutines([named("a", "A"), named("b", "B"), named("c", "C")], h.deps))).toEqual(["invalid", "failed", "created"]);
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("a 500 is failed and reported", async () => {
    const h = harness(() => problem(500, "internal"));
    expect(kinds(await createRoutines([named("a", "A")], h.deps))).toEqual(["failed"]);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "hevy-import", op: "routine" });
  });

  it("carries the translator's notices per routine", async () => {
    const long = named("a", `${"x".repeat(90)}`);
    const outcomes = await createRoutines([long, named("b", "B")], harness().deps);
    expect(outcomes[0]!.notices).toEqual([{ code: "name_trimmed", count: 1 }]);
    expect(outcomes[1]!.notices).toEqual([]);
  });

  it("the reducer keeps the workout results when the routines land", () => {
    const run = { sent: 1, total: 1, batchDate: null, batchesDone: 1, results: [{ hevyWorkoutId: "w" } as HevyImportResult], pause: null, stopReason: null };
    const before: ImportState = { ...initialImportState, step: "finishing", generation: 2, run };
    const started = importSession(before, { type: "routinesStart", total: 2 });
    expect(started).toMatchObject({ step: "routines_run", routineProgress: { done: 0, total: 2 } });
    const progressed = importSession(started, { type: "routinesProgress", done: 1, total: 2 });
    const done = importSession(progressed, { type: "routinesDone", outcomes: [{ hevyRoutineId: "a", name: "A", kind: "created", notices: [] }] });
    expect(done).toMatchObject({ step: "done", routineProgress: null });
    expect(done.routineResults.map((o) => o.kind)).toEqual(["created"]);
    expect(done.run).toBe(run);
  });
});
