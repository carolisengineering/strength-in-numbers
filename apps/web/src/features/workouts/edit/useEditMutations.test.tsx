import { act, renderHook, waitFor } from "@testing-library/react";
import { useIsMutating } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));

import type { SetEntry, WorkoutDetail } from "@sin/core";
import { ApiError } from "../../../api";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../../test/workoutHarness";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { HISTORY_KEYS } from "../../history/queries";
import { WORKOUT_KEYS } from "../queries";
import { useIsSetWritePending } from "../useWorkoutMutations";
import { EDIT_MUTATION_KEY, useEditCreateSet, useEditDeleteSet, useEditUpdateSet, useIsEditWritePending } from "./useEditMutations";

afterEach(() => observability.track.mockReset());

function seeded() {
  const qc = makeQueryClient();
  const detail = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 }), makeSet({ setNumber: 2 })] }],
  });
  qc.setQueryData(WORKOUT_KEYS.detail(detail.id), detail);
  qc.setQueryData(HISTORY_KEYS.list, { pages: [{ items: [], next: null }], pageParams: [null] });
  return { qc, detail, exercise: detail.exercises[0]!, set: detail.exercises[0]!.sets[0]! };
}

const notFound = () => new ApiError({ status: 404, type: "https://x/problems/not-found", title: "t", requestId: "r" });
const boom = () => new ApiError({ status: 500, type: "about:blank", title: "t", requestId: "r" });
const detailOf = (qc: ReturnType<typeof makeQueryClient>, id: string) => qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id))!;
const historyReset = (qc: ReturnType<typeof makeQueryClient>) => qc.getQueryState(HISTORY_KEYS.list)?.data === undefined;

describe("18.0 AC22 / AC14 / AC27 — the set hooks", () => {
  it("create: only the edit client is called; the row is inserted, history reset, set_added tracked", async () => {
    const { qc, detail, exercise } = seeded();
    const created = makeSet({ setNumber: 3, workoutExerciseId: exercise.id, reps: 5 });
    const live = fakeClient();
    const edit = fakeClient({ createSet: vi.fn(async () => created) });
    const { result } = renderHook(() => useEditCreateSet(), { wrapper: wrapperWith(qc, live, edit) });
    await act(() => result.current.mutateAsync({ workoutId: detail.id, workoutExerciseId: exercise.id, body: { reps: 5, isComplete: true } }));
    expect(edit.createSet).toHaveBeenCalledWith(exercise.id, { reps: 5, isComplete: true });
    expect(detailOf(qc, detail.id).exercises[0]!.sets.map((s) => s.id)).toEqual([...exercise.sets.map((s) => s.id), created.id]);
    expect(historyReset(qc)).toBe(true);
    expect(observability.track.mock.calls).toEqual([["workout_edit", { edit: "set_added" }]]);
  });

  it("update: the row is replaced and set_changed tracked", async () => {
    const { qc, detail, set } = seeded();
    const updated: SetEntry = { ...set, reps: 6 };
    const edit = fakeClient({ updateSet: vi.fn(async () => updated) });
    const { result } = renderHook(() => useEditUpdateSet(), { wrapper: wrapperWith(qc, fakeClient(), edit) });
    await act(() => result.current.mutateAsync({ workoutId: detail.id, id: set.id, body: { reps: 6 } }));
    expect(detailOf(qc, detail.id).exercises[0]!.sets[0]!.reps).toBe(6);
    expect(historyReset(qc)).toBe(true);
    expect(observability.track.mock.calls).toEqual([["workout_edit", { edit: "set_changed" }]]);
  });

  it("delete: the row is removed and set_deleted tracked; a 404 removes it too", async () => {
    const { qc, detail, exercise } = seeded();
    const edit = fakeClient({ deleteSet: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(notFound()) });
    const { result } = renderHook(() => useEditDeleteSet(), { wrapper: wrapperWith(qc, fakeClient(), edit) });
    await act(() => result.current.mutateAsync({ workoutId: detail.id, id: exercise.sets[0]!.id }));
    await act(() => result.current.mutateAsync({ workoutId: detail.id, id: exercise.sets[1]!.id }));
    expect(detailOf(qc, detail.id).exercises[0]!.sets).toEqual([]);
    expect(observability.track.mock.calls).toEqual([
      ["workout_edit", { edit: "set_deleted" }],
      ["workout_edit", { edit: "set_deleted" }],
    ]);
  });

  it("a failure leaves the cached detail the same object, the history list untouched, and tracks nothing", async () => {
    const { qc, detail, set } = seeded();
    const before = detailOf(qc, detail.id);
    const edit = fakeClient({ updateSet: () => Promise.reject(boom()), deleteSet: () => Promise.reject(boom()) });
    const update = renderHook(() => useEditUpdateSet(), { wrapper: wrapperWith(qc, fakeClient(), edit) });
    await act(() => update.result.current.mutateAsync({ workoutId: detail.id, id: set.id, body: { reps: 6 } }).catch(() => undefined));
    const del = renderHook(() => useEditDeleteSet(), { wrapper: wrapperWith(qc, fakeClient(), edit) });
    await act(() => del.result.current.mutateAsync({ workoutId: detail.id, id: set.id }).catch(() => undefined));
    expect(detailOf(qc, detail.id)).toBe(before);
    expect(historyReset(qc)).toBe(false);
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("carries EDIT_MUTATION_KEY; a pending edit is not a pending live set write", async () => {
    const { qc, detail, set } = seeded();
    const response = deferred<SetEntry>();
    const edit = fakeClient({ updateSet: () => response.promise });
    const { result } = renderHook(
      () => ({
        update: useEditUpdateSet(),
        edit: useIsEditWritePending(),
        live: useIsSetWritePending(),
        keyed: useIsMutating({ mutationKey: EDIT_MUTATION_KEY }),
      }),
      { wrapper: wrapperWith(qc, fakeClient(), edit) },
    );
    act(() => result.current.update.mutate({ workoutId: detail.id, id: set.id, body: { reps: 6 } }));
    await waitFor(() => expect(result.current.edit).toBe(true));
    expect(result.current.keyed).toBe(1);
    expect(result.current.live).toBe(false);
    await act(async () => response.resolve({ ...set, reps: 6 }));
    await waitFor(() => expect(result.current.edit).toBe(false));
  });

  it("unmount mid-flight: the detail is still written and history still reset (AC22)", async () => {
    const { qc, detail, set } = seeded();
    const response = deferred<SetEntry>();
    const edit = fakeClient({ updateSet: () => response.promise });
    const { result, unmount } = renderHook(() => useEditUpdateSet(), { wrapper: wrapperWith(qc, fakeClient(), edit) });
    act(() => result.current.mutate({ workoutId: detail.id, id: set.id, body: { reps: 6 } }));
    unmount();
    await act(async () => response.resolve({ ...set, reps: 6 }));
    await waitFor(() => expect(detailOf(qc, detail.id).exercises[0]!.sets[0]!.reps).toBe(6));
    expect(historyReset(qc)).toBe(true);
  });
});
