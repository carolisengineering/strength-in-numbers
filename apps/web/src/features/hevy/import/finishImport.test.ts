import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn() }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { HevyImportResult } from "@sin/core";
import { fakeImportApi, makeImportWorkout, testApiClient } from "../../../test/hevyImportFakes";
import { server } from "../../../test/msw/server";
import { deferred } from "../../../test/workoutHarness";
import { finishImport, needsFinish } from "./finishImport";
import { createHevyImportClient } from "./hevyImportClient";
import { importLane, resetImportLaneForTests } from "./importLane";
import type { RunState } from "./importSession";

beforeEach(() => observability.reportError.mockReset());
afterEach(() => resetImportLaneForTests());

function setup(options: Parameters<typeof fakeImportApi>[0] = {}) {
  const fake = fakeImportApi(options);
  server.use(...fake.handlers);
  return { fake, client: createHevyImportClient(testApiClient()) };
}

const result = (outcome: HevyImportResult["outcome"]): HevyImportResult => ({
  hevyWorkoutId: "h",
  outcome,
  workoutId: null,
  matchedWorkoutId: null,
  unpaired: [],
  drops: [],
  notices: [],
  exerciseCount: 1,
  setCount: 1,
});
const run = (...outcomes: HevyImportResult["outcome"][]): RunState => ({
  sent: outcomes.length,
  total: outcomes.length,
  batchDate: null,
  batchesDone: 1,
  results: outcomes.map(result),
  pause: null,
  stopReason: null,
});

describe("20.1 AC22 — finish", () => {
  it("is ok when the server recomputes", async () => {
    const { fake, client } = setup({ recordsStale: true });
    expect(await finishImport(client)).toBe("ok");
    expect(fake.log).toEqual([{ path: "/v1/hevy/import/finish", method: "POST", contentType: null, body: undefined }]);
    expect(fake.state.recordsStale).toBe(false);
  });

  it("is ok when the server answers recomputed: false (Review Focus 5)", async () => {
    const { client } = setup({ recordsStale: false });
    expect(await finishImport(client)).toBe("ok");
  });

  it("a 500 fails and is reported; a network error or a 4xx fails quietly", async () => {
    const { fake, client } = setup({ recordsStale: true });
    fake.failSequence([500]);
    expect(await finishImport(client)).toBe("failed");
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "hevy-import", op: "finish" });
    observability.reportError.mockReset();
    fake.failSequence(["network", 409]);
    expect(await finishImport(client)).toBe("failed");
    expect(await finishImport(client)).toBe("failed");
    expect(observability.reportError).not.toHaveBeenCalled();
    expect(fake.state.recordsStale).toBe(true);
  });

  it("needsFinish: only when the run created a workout, or the status says stale", () => {
    expect(needsFinish(run("create", "already_imported").results, { recordsStale: false })).toBe(true);
    expect(needsFinish(run("already_imported", "duplicate").results, { recordsStale: false })).toBe(false);
    expect(needsFinish(run("duplicate").results, { recordsStale: true })).toBe(true);
    expect(needsFinish([], { recordsStale: false })).toBe(false);
    expect(needsFinish([], undefined)).toBe(false);
  });
});

describe("20.1 AC22 — no overlap (Review Focus 6)", () => {
  it("a finish waits for the batch in flight", async () => {
    const { fake, client } = setup({ delayMs: 30 });
    const batch = importLane.run(() => client.importBatch({ dryRun: false, workouts: [makeImportWorkout("a")] }));
    const finished = finishImport(client);
    await batch;
    expect(await finished).toBe("ok");
    expect(fake.log.map((r) => r.path)).toEqual(["/v1/hevy/import/workouts", "/v1/hevy/import/finish"]);
    expect(fake.concurrency.maxInFlight).toBe(1);
  });

  it("no batch starts while a finish is in flight", async () => {
    const { fake, client } = setup({ delayMs: 30, recordsStale: true });
    const gate = deferred<void>();
    const finished = finishImport({ ...client, finish: async (signal) => (await gate.promise, client.finish(signal)) });
    const batch = importLane.run(() => client.importBatch({ dryRun: false, workouts: [makeImportWorkout("a")] }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(fake.log).toEqual([]);
    gate.resolve(undefined);
    await finished;
    await batch;
    expect(fake.log.map((r) => r.path)).toEqual(["/v1/hevy/import/finish", "/v1/hevy/import/workouts"]);
    expect(fake.concurrency.maxInFlight).toBe(1);
  });
});
