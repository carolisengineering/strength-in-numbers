import { afterEach, describe, expect, it, vi } from "vitest";

// The outbox reports through these; the 07.5 offline-finish case drives a real outbox (minor 681).
vi.mock("../../observability/track", () => ({ track: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: vi.fn() }));

import { WorkoutSchema } from "@sin/core";
import { createApiClient } from "../../api";
import { memoryStorageAdapter } from "../../storage/storage";
import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createOutbox } from "../workouts/outbox/outbox";
import { createWorkoutClient } from "../workouts/workoutClient";
import { createRecordsClient } from "./recordsClient";
import {
  dropUnknownRecordTypes,
  TolerantPersonalRecordsResponseSchema,
  TolerantUpdatedWorkoutSchema,
} from "./tolerantRecords";

/** A record of a type this build doesn't know (a made-up future one; Phase B's `max_reps_at_weight` is known now), otherwise well formed. */
function unknownTypeRecord(workoutId?: string): Record<string, unknown> {
  const known = makePersonalRecord(workoutId === undefined ? {} : { workoutId });
  return { ...known, recordType: "fastest_lap_at_distance", atDistanceM: 400, unit: "s", value: 64, previousValue: 66 };
}

function updatedWorkoutBody(newRecords: unknown[]) {
  const detail = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z" });
  return { workout: WorkoutSchema.parse(detail), body: { ...WorkoutSchema.parse(detail), newRecords } };
}

/** An `ApiClient` stand-in whose every method parses `payload` with the schema it is handed, as the real one does. */
function parsingApi(payload: unknown) {
  const parse = async (_path: string, ...rest: unknown[]) => {
    const schema = rest.find((r): r is { parse: (x: unknown) => unknown } => typeof (r as { parse?: unknown })?.parse === "function");
    return schema!.parse(payload);
  };
  // `request` (a call with the outbox's deadline signal) carries its schema in the init.
  const request = async (_path: string, init: { schema?: { parse: (x: unknown) => unknown } }) => init.schema!.parse(payload);
  return { get: parse, post: parse, patch: parse, delete: parse, request } as never;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("07.5 AC1 — unknown record types are dropped from record lists", () => {
  it("GET /v1/personal-records keeps the known records, in order, and drops the unknown one", () => {
    const known = makePersonalRecord();
    const known2 = makePersonalRecord({ recordType: "best_est_1rm" });
    const parsed = TolerantPersonalRecordsResponseSchema.parse({ records: [known, unknownTypeRecord(), known2] });
    expect(parsed.records).toEqual([known, known2]);
  });

  it("a finish whose newRecords holds only unknown types parses to newRecords [] and keeps the workout", () => {
    const { workout, body } = updatedWorkoutBody([unknownTypeRecord()]);
    const parsed = TolerantUpdatedWorkoutSchema.parse(body);
    expect(parsed.newRecords).toEqual([]);
    expect(WorkoutSchema.parse(parsed)).toEqual(workout);
  });

  it("dropUnknownRecordTypes passes a non-array through untouched", () => {
    expect(dropUnknownRecordTypes("x")).toBe("x");
    expect(dropUnknownRecordTypes(undefined)).toBeUndefined();
  });

  it("the records client returns the known records", async () => {
    const known = makePersonalRecord();
    const known2 = makePersonalRecord({ recordType: "max_reps", unit: "reps", value: 20, previousValue: 18 });
    const records = await createRecordsClient(parsingApi({ records: [known, unknownTypeRecord(), known2] })).listRecords({});
    expect(records).toEqual([known, known2]);
  });

  it("the plain client's finish, finishOrQueue and updateWorkout (Change Time) resolve with the unknown record gone", async () => {
    const detail = makeWorkoutDetail();
    const known = makePersonalRecord({ workoutId: detail.id });
    const { body } = updatedWorkoutBody([unknownTypeRecord(detail.id), known]);
    const client = createWorkoutClient(parsingApi(body));

    expect((await client.finish(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" })).newRecords).toEqual([known]);
    const meta = { startedAt: detail.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
    expect(await client.finishOrQueue(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" }, meta)).toEqual({ status: "landed" });
    expect((await client.updateWorkout(detail.id, { startedAt: "2026-10-02T10:00:00.000Z" })).newRecords).toEqual([known]);
  });

  it("07.5 offline finish: the outbox's finish keeps an unknown record type out and lands the rest (minor 681)", async () => {
    const detail = makeWorkoutDetail();
    const known = makePersonalRecord({ workoutId: detail.id });
    const { body } = updatedWorkoutBody([known, unknownTypeRecord(detail.id)]);
    const onFinishSynced = vi.fn();
    const outbox = createOutbox({
      storage: memoryStorageAdapter(),
      rest: createWorkoutClient(parsingApi(body)),
      userId: "u1",
      isOnline: () => true,
      onFinishSynced,
    });
    outbox.start();
    const meta = { startedAt: detail.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
    outbox.enqueueFinish({ workoutId: detail.id, body: { endedAt: "2026-10-02T11:00:00.000Z" }, meta });
    await vi.waitFor(() => expect(onFinishSynced).toHaveBeenCalled());
    expect(onFinishSynced.mock.calls[0]![1]).toMatchObject({ outcome: "landed", updated: { newRecords: [known] } });
  });

  it("a production build parses the finish without falling back to the raw body", async () => {
    const detail = makeWorkoutDetail();
    const { body } = updatedWorkoutBody([unknownTypeRecord(detail.id)]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const api = createApiClient({ baseUrl: "https://api.example.test", appEnv: "production", getToken: async () => "tok", onAuthLost: vi.fn() });

    const result = await createWorkoutClient(api).finish(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" });

    expect(result.newRecords).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("07.5 AC2 — everything else stays strict", () => {
  it("a known record missing value still fails", () => {
    const known = makePersonalRecord();
    expect(() => TolerantPersonalRecordsResponseSchema.parse({ records: [{ ...known, value: undefined }] })).toThrow();
  });

  it("a missing, null or non-string recordType still fails", () => {
    const known = makePersonalRecord();
    for (const recordType of [undefined, null, 7]) {
      expect(() => TolerantPersonalRecordsResponseSchema.parse({ records: [{ ...known, recordType }] })).toThrow();
      expect(() => TolerantUpdatedWorkoutSchema.parse(updatedWorkoutBody([{ ...known, recordType }]).body)).toThrow();
    }
  });

  it("a workout body missing id still fails, unknown records or not", () => {
    const { body } = updatedWorkoutBody([unknownTypeRecord()]);
    expect(() => TolerantUpdatedWorkoutSchema.parse({ ...body, id: undefined })).toThrow();
  });

  it("a records list that is not an array, or a body that is not an object, still fails", () => {
    expect(() => TolerantPersonalRecordsResponseSchema.parse({ records: "nope" })).toThrow();
    expect(() => TolerantPersonalRecordsResponseSchema.parse(null)).toThrow();
    expect(() => TolerantUpdatedWorkoutSchema.parse([])).toThrow();
  });
});
