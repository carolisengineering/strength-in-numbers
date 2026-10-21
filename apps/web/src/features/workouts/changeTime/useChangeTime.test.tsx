import { act, renderHook, waitFor } from "@testing-library/react";
import { useQuery } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));

import { UpdatedWorkoutSchema, type UpdatedWorkout, type WorkoutDetail } from "@sin/core";
import { ApiError } from "../../../api";
import { pinTimeZone } from "../../../test/timeZone";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../../test/workoutHarness";
import { HISTORY_KEYS } from "../../history/queries";
import { EDIT_MUTATION_KEY, useIsEditWritePending } from "../edit/useEditMutations";
import type { WorkoutClient } from "../workoutClient";
import { CHANGE_TIME_LIVE_KEY, useChangeTime, type ChangeTimeTarget } from "./useChangeTime";

pinTimeZone("Europe/London");
beforeEach(() => vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") }));
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
});

const KEY = ["workouts", "detail", "w"] as const;
const RECORDS = ["records", "all"] as const;

function seeded(endedAt: string | null = null) {
  const qc = makeQueryClient();
  const detail = makeWorkoutDetail({
    startedAt: "2026-10-18T09:05:00.000Z",
    endedAt,
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }],
  });
  qc.setQueryData(KEY, detail);
  qc.setQueryData(HISTORY_KEYS.list, { pages: [{ items: [], next: null }], pageParams: [null] });
  qc.setQueryData(RECORDS, { records: [] });
  return { qc, detail };
}

const updatedOf = (detail: WorkoutDetail, overrides: Partial<UpdatedWorkout>): UpdatedWorkout =>
  UpdatedWorkoutSchema.parse({ ...detail, ...overrides, updatedAt: "2026-10-18T10:00:00.000Z", newRecords: [] });

function render(qc: ReturnType<typeof makeQueryClient>, where: ChangeTimeTarget["where"], client: WorkoutClient) {
  return renderHook(() => ({ retime: useChangeTime({ where, client, cacheKey: KEY }), pending: useIsEditWritePending() }), {
    wrapper: wrapperWith(qc, fakeClient()),
  });
}

const cached = (qc: ReturnType<typeof makeQueryClient>) => qc.getQueryData<WorkoutDetail>(KEY)!;
const historyReset = (qc: ReturnType<typeof makeQueryClient>) => qc.getQueryState(HISTORY_KEYS.list)?.data === undefined;
const recordsInvalidated = (qc: ReturnType<typeof makeQueryClient>) => qc.getQueryState(RECORDS)?.isInvalidated === true;

describe("18.0 AC35 — a live save merges into the key the caller passes, only", () => {
  it("the response's times land in the cached entry; exercises, History and records are untouched", async () => {
    const { qc, detail } = seeded();
    const response = updatedOf(detail, {
      startedAt: "2026-10-16T17:00:00.000Z",
      localDate: "2026-10-16",
      tzOffsetMinutes: 60,
      plannedDurationSeconds: 3600,
    });
    const client = fakeClient({ updateWorkout: vi.fn(async () => response) });
    const { result } = render(qc, "live", client);
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { startedAt: response.startedAt, tzOffsetMinutes: 60, durationSeconds: 3600 } }));
    const after = cached(qc);
    expect([after.startedAt, after.localDate, after.tzOffsetMinutes, after.plannedDurationSeconds, after.updatedAt]).toEqual([
      "2026-10-16T17:00:00.000Z", "2026-10-16", 60, 3600, "2026-10-18T10:00:00.000Z",
    ]);
    expect(after.exercises).toBe(detail.exercises);
    expect(historyReset(qc)).toBe(false);
    expect(recordsInvalidated(qc)).toBe(false);
  });
});

describe("18.0 AC40 — an edit save merges and runs applyEditedCaches", () => {
  it("merges, resets History, invalidates records, and holds EDIT_MUTATION_KEY while pending", async () => {
    const { qc, detail } = seeded("2026-10-18T09:57:00.000Z");
    const held = deferred<UpdatedWorkout>();
    const response = updatedOf(detail, { startedAt: "2026-10-16T17:05:00.000Z", endedAt: "2026-10-16T17:57:00.000Z", localDate: "2026-10-16" });
    const { result } = render(qc, "edit", fakeClient({ updateWorkout: vi.fn(() => held.promise) }));
    let saved!: Promise<UpdatedWorkout>;
    act(() => {
      saved = result.current.retime.mutateAsync({ workout: detail, patch: { startedAt: response.startedAt, tzOffsetMinutes: 60 } });
    });
    await waitFor(() => expect(result.current.pending).toBe(true));
    expect(qc.getMutationCache().getAll()[0]!.options.mutationKey).toEqual(EDIT_MUTATION_KEY);
    await act(async () => {
      held.resolve(response);
      await saved;
    });
    expect([cached(qc).startedAt, cached(qc).localDate]).toEqual(["2026-10-16T17:05:00.000Z", "2026-10-16"]);
    expect(historyReset(qc)).toBe(true);
    expect(recordsInvalidated(qc)).toBe(true);
  });

  it("a live save is keyed CHANGE_TIME_LIVE_KEY, not the edit key", async () => {
    const { qc, detail } = seeded();
    const { result } = render(qc, "live", fakeClient({ updateWorkout: vi.fn(async () => updatedOf(detail, {})) }));
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { durationSeconds: 600 } }));
    expect(qc.getMutationCache().getAll()[0]!.options.mutationKey).toEqual(CHANGE_TIME_LIVE_KEY);
  });
});

describe("18.0 AC35 — a live save answered with a finished workout", () => {
  it("is not merged into the live key; History resets and the key is invalidated", async () => {
    const { qc, detail } = seeded();
    const response = updatedOf(detail, { endedAt: "2026-10-18T09:55:00.000Z" });
    const { result } = render(qc, "live", fakeClient({ updateWorkout: vi.fn(async () => response) }));
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { durationSeconds: 600 } }));
    expect(cached(qc).endedAt).toBeNull();
    expect(historyReset(qc)).toBe(true);
    expect(qc.getQueryState(KEY)?.isInvalidated).toBe(true);
  });
});

describe("18.0 AC41 — failure leaves the cache", () => {
  it("a rejected save leaves the cached entry as it was and tracks nothing", async () => {
    const { qc, detail } = seeded();
    const fail = new ApiError({ status: 500, type: "about:blank", title: "t", requestId: "r" });
    const { result } = render(qc, "edit", fakeClient({ updateWorkout: vi.fn(async () => Promise.reject(fail)) }));
    await act(async () => {
      await result.current.retime.mutateAsync({ workout: detail, patch: { durationSeconds: 600 } }).catch(() => undefined);
    });
    expect(cached(qc)).toBe(detail);
    expect(observability.track).not.toHaveBeenCalled();
  });
});

describe("18.0 AC43 — workout_retimed", () => {
  it("start + duration, Fri 16 Oct from Sun 18 Oct → changed both, daysBack 2", async () => {
    const { qc, detail } = seeded("2026-10-18T09:57:00.000Z");
    const response = updatedOf(detail, { startedAt: "2026-10-16T17:00:00.000Z", endedAt: "2026-10-16T18:00:00.000Z" });
    const { result } = render(qc, "edit", fakeClient({ updateWorkout: vi.fn(async () => response) }));
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { startedAt: response.startedAt, tzOffsetMinutes: 60, durationSeconds: 3600 } }));
    expect(observability.track.mock.calls).toEqual([["workout_retimed", { where: "edit", changed: "both", daysBack: 2 }]]);
  });

  it("duration only → no daysBack key", async () => {
    const { qc, detail } = seeded();
    const { result } = render(qc, "live", fakeClient({ updateWorkout: vi.fn(async () => updatedOf(detail, { plannedDurationSeconds: 600 })) }));
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { durationSeconds: 600 } }));
    expect(observability.track.mock.calls).toEqual([["workout_retimed", { where: "live", changed: "duration" }]]);
  });
});

describe("18.0 AC35 — a read in flight when the save lands cannot overwrite it", () => {
  it("cancels the read, merges, and re-reads exactly once", async () => {
    const { qc, detail } = seeded();
    const response = updatedOf(detail, { startedAt: "2026-10-16T17:00:00.000Z", localDate: "2026-10-16" });
    const stale = deferred<WorkoutDetail>();
    const queryFn = vi
      .fn<() => Promise<WorkoutDetail>>()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementation(async () => ({ ...detail, startedAt: response.startedAt, localDate: "2026-10-16" }));
    const client = fakeClient({ updateWorkout: vi.fn(async () => response) });
    const { result } = renderHook(
      () => ({ read: useQuery({ queryKey: KEY, queryFn, staleTime: 0 }), retime: useChangeTime({ where: "live", client, cacheKey: KEY }) }),
      { wrapper: wrapperWith(qc, fakeClient()) },
    );
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(1));
    await act(() => result.current.retime.mutateAsync({ workout: detail, patch: { startedAt: response.startedAt, tzOffsetMinutes: 60 } }));
    stale.resolve(detail); // the cancelled read answers late with the old start
    await waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.read.isFetching).toBe(false));
    expect(cached(qc).startedAt).toBe("2026-10-16T17:00:00.000Z");
    expect(queryFn).toHaveBeenCalledTimes(2);
  });
});
