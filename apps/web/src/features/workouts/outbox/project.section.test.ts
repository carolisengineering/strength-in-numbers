import { describe, expect, it } from "vitest";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import type { NoteOp, OutboxOp, ResultOp, RoundOp } from "./ops";
import { project, resultFromBody } from "./project";

const detail = () =>
  makeWorkoutDetail({
    sections: [
      { name: "Finisher", timer: { format: "amrap", capSeconds: 720 }, roundTimes: [{ round: 1, seconds: 250 }, { round: 3, seconds: 770 }] },
      { name: "Other", timer: { format: "set_timer", roundSeconds: 300, rounds: 5 } },
    ],
    exercises: [{ modality: "weight_reps", name: "Burpee", sectionIndex: 0, sets: [makeSet({ setNumber: 1 })] }],
  });
let n = 0;
const common = (workoutId: string) => ({ id: `op-${++n}`, workoutId, userId: "u", status: "queued" as const, attempted: false, attempts: 0, nextAttemptAt: 0, enqueuedAt: 0 });
const round = (workoutId: string, sectionId: string, r: number, seconds: number | null, over: Partial<RoundOp> = {}): RoundOp => ({
  ...common(workoutId), kind: "round", sectionId, round: r, body: { seconds }, ...over,
});
const result = (workoutId: string, sectionId: string, body: ResultOp["body"], over: Partial<ResultOp> = {}): ResultOp => ({
  ...common(workoutId), kind: "result", sectionId, body, ...over,
});
const run = (w: ReturnType<typeof detail>, ops: OutboxOp[]) => project(w, { ops, idMap: {} });

describe("10.7 AC38 — projection overlays round and result ops", () => {
  it("rounds set and cleared in queue order, kept sorted; the result's full object; pending under the section id", () => {
    const w = detail();
    const s = w.sections[0]!.id;
    const out = run(w, [round(w.id, s, 2, 515), round(w.id, s, 3, null), result(w.id, s, { rounds: 5, reps: 7 })]);
    expect(out.workout.sections[0]!.roundTimes).toEqual([{ round: 1, seconds: 250 }, { round: 2, seconds: 515 }]);
    expect(out.workout.sections[0]!.result).toEqual({ rounds: 5, reps: 7, finishSeconds: null, capped: false });
    expect(out.sync.get(s)).toEqual({ state: "pending" });
  });

  it("a result clear projects null", () => {
    const w = { ...detail() };
    const s = w.sections[0]!.id;
    const withResult = run(w, [result(w.id, s, { rounds: 5, reps: 7 })]).workout;
    expect(run(withResult, [result(w.id, s, null)]).workout.sections[0]!.result).toBeNull();
  });

  it("a failed op still overlays and marks failed with its id and status", () => {
    const w = detail();
    const s = w.sections[0]!.id;
    const op = round(w.id, s, 2, 515, { status: "failed", failure: { status: 409, type: "section-timer-mismatch", requestId: null } });
    const out = run(w, [op]);
    expect(out.workout.sections[0]!.roundTimes.map((t) => t.round)).toEqual([1, 2, 3]);
    expect(out.sync.get(s)).toEqual({ state: "failed", opId: op.id, status: 409 });
  });

  it("idempotent and reference-stable", () => {
    const w = detail();
    const s = w.sections[0]!.id;
    const ops = [round(w.id, s, 2, 515), result(w.id, s, { rounds: 5, reps: 7 })];
    const once = run(w, ops).workout;
    const twice = run(once, ops).workout;
    expect(twice).toEqual(once);
    expect(twice.sections).toBe(once.sections);
  });

  it("ops of another workout or an unknown section are ignored", () => {
    const w = detail();
    const out = run(w, [round("other", w.sections[0]!.id, 2, 515), round(w.id, "00000000-0000-4000-8000-0000000000ff", 2, 515)]);
    expect(out.workout).toBe(w);
    expect(out.sync.size).toBe(0);
  });

  it("an exercise-only queue leaves sections reference-equal", () => {
    const w = detail();
    const noteOp: NoteOp = { ...common(w.id), kind: "note", workoutExerciseId: w.exercises[0]!.id, body: { notes: "x" } };
    expect(run(w, [noteOp]).workout.sections).toBe(w.sections);
  });

  it("resultFromBody fills the full object", () => {
    expect(resultFromBody({ capped: true, reps: 7 })).toEqual({ rounds: null, reps: 7, finishSeconds: null, capped: true });
    expect(resultFromBody({ finishSeconds: 860 })).toEqual({ rounds: null, reps: null, finishSeconds: 860, capped: false });
  });
});
