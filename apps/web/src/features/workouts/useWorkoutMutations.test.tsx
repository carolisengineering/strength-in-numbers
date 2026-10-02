import { useEffect } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useIsMutating } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { ApiError } from "../../api";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { WORKOUT_KEYS, useActiveWorkout } from "./queries";
import {
  SET_MUTATION_KEY,
  useAddExercise,
  useCreateSet,
  useDeleteSet,
  useFinishWorkout,
  useRemoveExercise,
  useUpdateSet,
} from "./useWorkoutMutations";

const notFound = () => new ApiError({ status: 404, type: "https://x/problems/not-found", title: "Not found", requestId: "r" });

function seeded() {
  const qc = makeQueryClient();
  const detail = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", sets: [makeSet({ setNumber: 1 })] }] });
  qc.setQueryData(WORKOUT_KEYS.active, detail);
  return { qc, detail, exercise: detail.exercises[0]! };
}

const createVars = (workoutExerciseId: string) => ({
  workoutExerciseId,
  body: { reps: 8, isComplete: true },
  modality: "weight_reps" as const,
  msToLog: 0,
  edited: false,
});

describe("AC11 — a write-through cache update survives an in-flight refetch", () => {
  it("keeps the new set when an older refetch resolves after the POST", async () => {
    const { qc, detail, exercise } = seeded();
    const created = makeSet({ workoutExerciseId: exercise.id, setNumber: 2 });
    const release = deferred<WorkoutDetail | null>();

    // A refetch that began before the POST committed.
    const inflight = qc
      .fetchQuery({ queryKey: WORKOUT_KEYS.active, queryFn: () => release.promise, staleTime: 0 })
      .catch(() => undefined);

    const { result } = renderHook(() => useCreateSet(), {
      wrapper: wrapperWith(qc, fakeClient({ createSet: async () => created })),
    });
    await act(() => result.current.mutateAsync(createVars(exercise.id)));

    release.resolve(detail); // the stale response lands after the write
    await inflight;

    const sets = qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.exercises[0]!.sets;
    expect(sets.map((s) => s.id)).toContain(created.id);
  });
});

describe("AC12 — cache writes survive navigating away mid-request", () => {
  it("updates the cache though the calling component unmounted before the response", async () => {
    const { qc, exercise } = seeded();
    const created = makeSet({ workoutExerciseId: exercise.id, setNumber: 2 });
    const response = deferred<typeof created>();

    function Caller() {
      const { mutate } = useCreateSet();
      useEffect(() => {
        mutate(createVars(exercise.id)); // no call-level callbacks: those are skipped after unmount
      }, [mutate]);
      return null;
    }

    const Wrapper = wrapperWith(qc, fakeClient({ createSet: () => response.promise }));
    const { unmount } = render(<Caller />, { wrapper: Wrapper });
    unmount();
    response.resolve(created);

    await waitFor(() => {
      const sets = qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.exercises[0]!.sets;
      expect(sets.map((s) => s.id)).toContain(created.id);
    });
  });
});

describe("set writes", () => {
  it("are tagged with SET_MUTATION_KEY so Finish can wait for them", async () => {
    const { qc, exercise } = seeded();
    const response = deferred<ReturnType<typeof makeSet>>();
    const { result } = renderHook(
      () => ({ create: useCreateSet(), pending: useIsMutating({ mutationKey: SET_MUTATION_KEY }) }),
      { wrapper: wrapperWith(qc, fakeClient({ createSet: () => response.promise })) },
    );
    act(() => result.current.create.mutate(createVars(exercise.id)));
    await waitFor(() => expect(result.current.pending).toBe(1));
    response.resolve(makeSet({ workoutExerciseId: exercise.id, setNumber: 2 }));
    await waitFor(() => expect(result.current.pending).toBe(0));
  });

  it("an update upserts the returned set", async () => {
    const { qc, detail, exercise } = seeded();
    const updated = { ...exercise.sets[0]!, weight: 62.5 };
    const { result } = renderHook(() => useUpdateSet(), {
      wrapper: wrapperWith(qc, fakeClient({ updateSet: async () => updated })),
    });
    await act(() => result.current.mutateAsync({ id: updated.id, body: { weight: 62.5 }, modality: "weight_reps" }));
    expect(qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.exercises[0]!.sets[0]!.weight).toBe(62.5);
    expect(detail.exercises[0]!.sets[0]!.weight).toBe(60);
  });

  it.each([
    ["204", async () => undefined],
    ["404", async () => Promise.reject(notFound())],
  ])("a delete answering %s removes the set from the cache", async (_label, deleteSet) => {
    const { qc, exercise } = seeded();
    const { result } = renderHook(() => useDeleteSet(), {
      wrapper: wrapperWith(qc, fakeClient({ deleteSet })),
    });
    await act(() => result.current.mutateAsync({ id: exercise.sets[0]!.id, modality: "weight_reps" }));
    expect(qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.exercises[0]!.sets).toEqual([]);
  });

  it("a delete answering 500 rejects and leaves the cache alone", async () => {
    const { qc, exercise } = seeded();
    const boom = new ApiError({ status: 500, type: "about:blank", title: "Boom", requestId: "r" });
    const { result } = renderHook(() => useDeleteSet(), {
      wrapper: wrapperWith(qc, fakeClient({ deleteSet: () => Promise.reject(boom) })),
    });
    await act(async () => {
      await expect(result.current.mutateAsync({ id: exercise.sets[0]!.id, modality: "weight_reps" })).rejects.toBe(boom);
    });
    expect(qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)!.exercises[0]!.sets).toHaveLength(1);
  });
});

describe("exercise-structure writes", () => {
  it("stay pending until the follow-up refetch settles (serialisation, §6.3)", async () => {
    const { qc, detail, exercise } = seeded();
    const refetch = deferred<WorkoutDetail | null>();
    let reads = 0;
    const client = fakeClient({
      getActive: () => (++reads === 1 ? Promise.resolve(detail) : refetch.promise),
      addExercise: async () => ({ ...exercise, id: "added" }) as never,
    });
    // invalidateQueries only refetches queries somebody is observing, so mount the active query too.
    const { result } = renderHook(() => ({ active: useActiveWorkout(), add: useAddExercise() }), {
      wrapper: wrapperWith(qc, client),
    });
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    await waitFor(() => expect(reads).toBe(1));

    let settled = false;
    act(() => {
      void result.current.add
        .mutateAsync({ workoutId: detail.id, exerciseId: "e1", modality: "weight_reps" })
        .then(() => (settled = true));
    });
    await waitFor(() => expect(reads).toBe(2)); // the refetch has started and is held open
    expect(settled).toBe(false);
    expect(result.current.add.isPending).toBe(true);

    refetch.resolve(detail);
    await waitFor(() => expect(settled).toBe(true));
  });

  it("a remove answering 404 counts as success", async () => {
    const { qc } = seeded();
    const { result } = renderHook(() => useRemoveExercise(), {
      wrapper: wrapperWith(qc, fakeClient({ removeExercise: () => Promise.reject(notFound()) })),
    });
    await act(() => result.current.mutateAsync({ id: "we", setCount: 0 }));
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
  });
});

describe("finish", () => {
  it("seeds the detail cache with the finished workout and returns it; leaves the active entry to the summary screen (06.4 AC1)", async () => {
    const { qc, detail } = seeded();
    const finished = {
      id: detail.id,
      title: null,
      notes: null,
      startedAt: detail.startedAt,
      endedAt: "2026-10-02T11:00:00.000Z",
      localDate: detail.localDate,
      tzOffsetMinutes: 0,
      clientGeneratedId: detail.clientGeneratedId,
      source: "manual",
      createdAt: detail.createdAt,
      updatedAt: "2026-10-02T11:00:00.000Z",
    } as const;
    const { result } = renderHook(() => useFinishWorkout(), {
      wrapper: wrapperWith(qc, fakeClient({ finish: async () => finished })),
    });
    await act(() => result.current.mutateAsync({ id: detail.id, endedAt: finished.endedAt }));
    expect(qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.active)?.id).toBe(detail.id);
    const seededDetail = qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(detail.id))!;
    expect(seededDetail.endedAt).toBe(finished.endedAt);
    expect(seededDetail.exercises).toHaveLength(1);
  });
});
