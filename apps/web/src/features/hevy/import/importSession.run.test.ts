import { describe, expect, it } from "vitest";
import type { HevyImportResult } from "@sin/core";

import { importSession, initialImportState, type ImportState } from "./importSession";

const result = (id: string, outcome: HevyImportResult["outcome"] = "create"): HevyImportResult => ({
  hevyWorkoutId: id,
  outcome,
  workoutId: null,
  matchedWorkoutId: null,
  unpaired: [],
  drops: [],
  notices: [],
  exerciseCount: 1,
  setCount: 2,
});

const summary: ImportState = { ...initialImportState, step: "summary", generation: 3, results: [result("a"), result("b"), result("c")] };
const running = importSession(summary, { type: "runStart", generation: 4, total: 3, batchDate: "2026-10-01T09:00:00Z" });

describe("20.1 AC16 — reducer", () => {
  it("runStart goes to running under the new generation, with nothing sent yet", () => {
    expect(running).toMatchObject({
      step: "running",
      generation: 4,
      run: { sent: 0, total: 3, batchesDone: 0, batchDate: "2026-10-01T09:00:00Z", results: [], pause: null, stopReason: null },
    });
  });

  it("batchDone adds to sent, the results and the batches done, and moves the date to the next batch", () => {
    const next = importSession(running, { type: "batchDone", generation: 4, results: [result("a"), result("b", "already_imported")], nextDate: "2026-09-01T09:00:00Z" });
    expect(next.run).toMatchObject({ sent: 2, batchesDone: 1, batchDate: "2026-09-01T09:00:00Z" });
    expect(next.run!.results.map((r) => r.outcome)).toEqual(["create", "already_imported"]);
  });

  it("runPaused goes to paused with its reason, and resume goes back to running", () => {
    const paused = importSession(running, { type: "runPaused", generation: 4, reason: "unreachable" });
    expect(paused).toMatchObject({ step: "paused", run: { pause: "unreachable" } });
    const resumed = importSession(paused, { type: "resume", generation: 5 });
    expect(resumed).toMatchObject({ step: "running", generation: 5, run: { pause: null, stopReason: null } });
  });

  it("runStopped goes to stopped with its reason, keeping the counts", () => {
    const once = importSession(running, { type: "batchDone", generation: 4, results: [result("a")], nextDate: null });
    const stopped = importSession(once, { type: "runStopped", generation: 4, reason: { kind: "user" } });
    expect(stopped).toMatchObject({ step: "stopped", run: { sent: 1, stopReason: { kind: "user" } } });
  });

  it("finishStart leaves running for finishing; finishSkipped leaves nothing running", () => {
    const finishing = importSession(running, { type: "finishStart" });
    expect(finishing).toMatchObject({ step: "finishing", finish: "running" });
    expect(importSession(finishing, { type: "finishSkipped" })).toMatchObject({ step: "finishing", finish: "idle" });
  });

  it("minor 250 — runFailed: running or paused stops with the error reason; a wrap-up goes to done with an unanswered finish failed", () => {
    expect(importSession(running, { type: "runFailed" })).toMatchObject({ step: "stopped", run: { stopReason: { kind: "error" } } });
    const paused = importSession(running, { type: "runPaused", generation: 4, reason: "unreachable" });
    expect(importSession(paused, { type: "runFailed" })).toMatchObject({ step: "stopped", run: { stopReason: { kind: "error" } } });
    const finishing = importSession(running, { type: "finishStart" });
    expect(importSession(finishing, { type: "runFailed" })).toMatchObject({ step: "done", finish: "failed" });
    const routines = importSession(importSession(finishing, { type: "finishDone", ok: true }), { type: "routinesStart", total: 2 });
    expect(importSession(routines, { type: "runFailed" })).toMatchObject({ step: "done", finish: "ok", routineProgress: null });
    expect(importSession(summary, { type: "runFailed" })).toBe(summary);
  });

  it("a batchDone from an older generation is ignored", () => {
    expect(importSession(running, { type: "batchDone", generation: 3, results: [result("a")], nextDate: null })).toBe(running);
  });
});
