import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutSchema } from "@sin/core";
import { createApiClient } from "../../api";
import { makePersonalRecord, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutClient } from "../workouts/workoutClient";
import { createRecordsClient } from "./recordsClient";
import {
  dropUnknownRecordTypes,
  TolerantPersonalRecordsResponseSchema,
  TolerantUpdatedWorkoutSchema,
} from "./tolerantRecords";

/** A record of a type this build doesn't know yet (Spec 07.5 Phase B's), otherwise well formed. */
function unknownTypeRecord(workoutId?: string): Record<string, unknown> {
  const known = makePersonalRecord(workoutId === undefined ? {} : { workoutId });
  return { ...known, recordType: "max_reps_at_weight", atWeightKg: 12.5, unit: "reps", value: 14, previousValue: 12 };
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
  return { get: parse, post: parse, patch: parse, delete: parse } as never;
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

  it("the workout client's finish, finishOrQueue and updateWorkout (Change Time) resolve with the unknown record gone", async () => {
    const detail = makeWorkoutDetail();
    const known = makePersonalRecord({ workoutId: detail.id });
    const { body } = updatedWorkoutBody([unknownTypeRecord(detail.id), known]);
    const client = createWorkoutClient(parsingApi(body));

    expect((await client.finish(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" })).newRecords).toEqual([known]);
    const meta = { startedAt: detail.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };
    expect(await client.finishOrQueue(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" }, meta)).toEqual({ status: "landed" });
    expect((await client.updateWorkout(detail.id, { startedAt: "2026-10-02T10:00:00.000Z" })).newRecords).toEqual([known]);
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
