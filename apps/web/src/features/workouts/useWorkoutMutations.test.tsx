import { useEffect, type ReactNode } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { useIsMutating } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutDetail } from "@sin/core";
import { ApiError } from "../../api";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { HISTORY_KEYS } from "../history/queries";
import { PROGRESS_KEYS } from "../progress/queries";
import { RECORDS_KEYS } from "../records/queries";
import { memoryStorageAdapter } from "../../storage/storage";
import { DraftStoresContext } from "./drafts/DraftStoreContext";
import { RestStoresContext } from "./useRestTimer";
import { createOutbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import { WORKOUT_KEYS, useActiveWorkout } from "./queries";
import {
  SET_MUTATION_KEY,
  useAddExercise,
  useCreateSet,
  useDeleteSet,
  useDeleteWorkout,
  useFinishWorkout,
  useRemoveExercise,
  useUpdateSet,
} from "./useWorkoutMutations";

const trackSpy = vi.hoisted(() => vi.fn());
vi.mock("../../observability/track", () => ({ track: trackSpy }));

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

  describe("17.5 AC17 — set_deleted says how it got there", () => {
    it.each([
      ["an Undo", { viaUndo: true }, true],
      ["Delete set", {}, false],
    ])("%s", async (_label, extra, viaUndo) => {
      trackSpy.mockClear();
      const { qc, exercise } = seeded();
      const { result } = renderHook(() => useDeleteSet(), {
        wrapper: wrapperWith(qc, fakeClient({ deleteSet: async () => undefined })),
      });
      await act(() => result.current.mutateAsync({ id: exercise.sets[0]!.id, modality: "weight_reps", ...extra }));
      expect(trackSpy).toHaveBeenCalledWith("set_deleted", { modality: "weight_reps", viaUndo });
    });
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

  it("10.7 AC22 / minor 323 — Add exercise asks again when its re-read is canceled, up to three times", async () => {
    const { qc, detail, exercise } = seeded();
    const client = fakeClient({ getActive: () => Promise.resolve(detail), addExercise: async () => ({ ...exercise, id: "added" }) as never });
    const { result } = renderHook(() => ({ active: useActiveWorkout(), add: useAddExercise() }), { wrapper: wrapperWith(qc, client) });
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    // A set write's guard cancels each re-read: the call returns and nothing new lands.
    const reread = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    await act(() => result.current.add.mutateAsync({ workoutId: detail.id, exerciseId: "e1", modality: "weight_reps" }));
    expect(reread.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(WORKOUT_KEYS.active))).toHaveLength(3);
  });

  it("minor 539 — Remove exercise asks again when its re-read is canceled, up to three times", async () => {
    const { qc, detail } = seeded();
    const client = fakeClient({ getActive: () => Promise.resolve(detail), removeExercise: async () => undefined });
    const { result } = renderHook(() => ({ active: useActiveWorkout(), remove: useRemoveExercise() }), { wrapper: wrapperWith(qc, client) });
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    const reread = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
    await act(() => result.current.remove.mutateAsync({ id: "we", setCount: 0 }));
    expect(reread.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(WORKOUT_KEYS.active))).toHaveLength(3);
  });

  it("minor 596 — Remove exercise stops asking once the second re-read lands, and resolves only then", async () => {
    const { qc, detail } = seeded();
    const held = deferred<WorkoutDetail>();
    let getActiveCalls = 0;
    const client = fakeClient({
      getActive: () => {
        getActiveCalls += 1;
        return getActiveCalls === 1 ? Promise.resolve(detail) : held.promise;
      },
      removeExercise: async () => undefined,
    });
    const { result } = renderHook(() => ({ active: useActiveWorkout(), remove: useRemoveExercise() }), { wrapper: wrapperWith(qc, client) });
    await waitFor(() => expect(result.current.active.isSuccess).toBe(true));
    // The first re-read is canceled (a set write's guard); the later ones run for real.
    const reread = vi.spyOn(qc, "invalidateQueries").mockImplementationOnce(async () => undefined);
    let settled = false;
    let removing!: Promise<void>;
    act(() => {
      removing = result.current.remove.mutateAsync({ id: "we", setCount: 0 }).then(() => {
        settled = true;
      });
    });
    await waitFor(() => expect(getActiveCalls).toBe(2));
    expect(settled).toBe(false);
    await act(async () => {
      held.resolve({ ...detail });
      await removing;
    });
    expect(settled).toBe(true);
    expect(reread.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(WORKOUT_KEYS.active))).toHaveLength(2);
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

const META = { startedAt: "2026-10-02T10:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false };

describe("06.7 AC14 — useFinishWorkout has no landing effects of its own", () => {
  it("sends finishOrQueue with the body and meta, and a landed outcome seeds, clears and tracks nothing (the provider's onFinishSynced does)", async () => {
    const { qc, detail } = seeded();
    const finishOrQueue = vi.fn(async () => ({ status: "landed" as const }));
    const { result } = renderHook(() => useFinishWorkout(), { wrapper: wrapperWith(qc, fakeClient({ finishOrQueue })) });
    trackSpy.mockClear();
    await act(() => result.current.mutateAsync({ id: detail.id, endedAt: "2026-10-02T11:00:00.000Z", keepRoutine: false, meta: META }));
    expect(finishOrQueue).toHaveBeenCalledWith(detail.id, { endedAt: "2026-10-02T11:00:00.000Z" }, META);
    expect(qc.getQueryData(WORKOUT_KEYS.detail(detail.id))).toBeUndefined();
    expect(qc.getQueryData(WORKOUT_KEYS.active)).toBe(detail);
    expect(trackSpy).not.toHaveBeenCalled();
  });

  it("keepRoutine goes on the wire only as true (10.5 AC13)", async () => {
    const { qc, detail } = seeded();
    const finishOrQueue = vi.fn(async () => ({ status: "landed" as const }));
    const { result } = renderHook(() => useFinishWorkout(), { wrapper: wrapperWith(qc, fakeClient({ finishOrQueue })) });
    await act(() => result.current.mutateAsync({ id: detail.id, endedAt: "2026-10-02T11:00:00.000Z", keepRoutine: true, meta: META }));
    expect(finishOrQueue).toHaveBeenCalledWith(detail.id, { endedAt: "2026-10-02T11:00:00.000Z", keepRoutine: true }, META);
  });
});

describe("06.7 AC15 — a queued outcome does only the queued effects, at hook level", () => {
  it("seeds the projected summary from the outbox, clears the rest timer and tracks workout_finish_queued", async () => {
    const { qc, detail } = seeded();
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: fakeClient(), userId: "u1", isOnline: () => false });
    const rest = { clearWorkout: vi.fn() };
    const finishOrQueue = vi.fn(async () => {
      outbox.enqueueFinish({ workoutId: detail.id, body: { endedAt: "2026-10-02T11:00:00.000Z" }, meta: META });
      return { status: "queued" as const, reason: "offline" as const, durable: true };
    });
    const Inner = wrapperWith(qc, fakeClient({ finishOrQueue }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Inner>
        <OutboxContext.Provider value={outbox}>
          <RestStoresContext.Provider value={rest as never}>{children}</RestStoresContext.Provider>
        </OutboxContext.Provider>
      </Inner>
    );
    const { result } = renderHook(() => useFinishWorkout(), { wrapper });
    trackSpy.mockClear();
    await act(() => result.current.mutateAsync({ id: detail.id, endedAt: "2026-10-02T11:00:00.000Z", meta: META }));
    expect(qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(detail.id))?.endedAt).toBe("2026-10-02T11:00:00.000Z");
    expect(rest.clearWorkout).toHaveBeenCalledWith(detail.id);
    expect(trackSpy.mock.calls).toEqual([["workout_finish_queued", { reason: "offline" }]]);
  });
});

describe("08.0 AC8 — delete success at hook level", () => {
  it("a finished-phase delete removes the records entry and invalidates history and records", async () => {
    const qc = makeQueryClient();
    const W = "40000000-0000-4000-8000-0000000000aa";
    qc.setQueryData(RECORDS_KEYS.forWorkout(W), []);
    qc.setQueryData(RECORDS_KEYS.forExercise("e"), []);
    qc.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
    const { result } = renderHook(() => useDeleteWorkout(), {
      wrapper: wrapperWith(qc, fakeClient({ deleteWorkout: async () => undefined })),
    });

    await act(() => result.current.mutateAsync({ id: W, phase: "finished", setCount: 1 }));

    expect(qc.getQueryState(RECORDS_KEYS.forWorkout(W))).toBeUndefined();
    expect(qc.getQueryState(HISTORY_KEYS.list)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(RECORDS_KEYS.forExercise("e"))?.isInvalidated).toBe(true);
  });

  it("a 404 on delete (already gone) applies the same effects", async () => {
    const qc = makeQueryClient();
    const W = "40000000-0000-4000-8000-0000000000ab";
    qc.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
    const { result } = renderHook(() => useDeleteWorkout(), {
      wrapper: wrapperWith(qc, fakeClient({ deleteWorkout: () => Promise.reject(notFound()) })),
    });

    await act(() => result.current.mutateAsync({ id: W, phase: "finished", setCount: 1 }));

    expect(qc.getQueryState(HISTORY_KEYS.list)?.isInvalidated).toBe(true);
  });

  it("an active-phase discard touches neither history nor records", async () => {
    const qc = makeQueryClient();
    const W = "40000000-0000-4000-8000-0000000000ac";
    qc.setQueryData(HISTORY_KEYS.list, { pages: [], pageParams: [] });
    qc.setQueryData(RECORDS_KEYS.forExercise("e"), []);
    qc.setQueryData(PROGRESS_KEYS.series("e", "3m"), { exerciseId: "e", points: [] });
    const { result } = renderHook(() => useDeleteWorkout(), {
      wrapper: wrapperWith(qc, fakeClient({ deleteWorkout: async () => undefined })),
    });

    await act(() => result.current.mutateAsync({ id: W, phase: "active", setCount: 0 }));

    expect(qc.getQueryState(HISTORY_KEYS.list)?.isInvalidated).toBe(false);
    expect(qc.getQueryState(RECORDS_KEYS.forExercise("e"))?.isInvalidated).toBe(false);
    // Spec 08.1 AC8: nor progress.
    expect(qc.getQueryState(PROGRESS_KEYS.series("e", "3m"))?.isInvalidated).toBe(false);
  });
});

describe("06.5 AC10 — finish and discard clear the workout's drafts", () => {
  const stores = () => ({ forWorkout: vi.fn(), clearWorkout: vi.fn(), flushAll: vi.fn() });
  const wrapperWithDrafts = (qc: ReturnType<typeof makeQueryClient>, client: ReturnType<typeof fakeClient>, s: ReturnType<typeof stores>) => {
    const Inner = wrapperWith(qc, client);
    return function Wrapper({ children }: { children: ReactNode }) {
      return (
        <Inner>
          <DraftStoresContext.Provider value={s}>{children}</DraftStoresContext.Provider>
        </Inner>
      );
    };
  };

  it("useDeleteWorkout clears on success and not on failure", async () => {
    const { qc, detail } = seeded();
    const s = stores();
    const ok = renderHook(() => useDeleteWorkout(), { wrapper: wrapperWithDrafts(qc, fakeClient({ deleteWorkout: async () => undefined }), s) });
    await act(() => ok.result.current.mutateAsync({ id: detail.id, phase: "active", setCount: 1 }));
    expect(s.clearWorkout).toHaveBeenCalledWith(detail.id);

    const s2 = stores();
    const bad = renderHook(() => useDeleteWorkout(), { wrapper: wrapperWithDrafts(qc, fakeClient({ deleteWorkout: async () => Promise.reject(new Error("boom")) }), s2) });
    await act(async () => {
      await bad.result.current.mutateAsync({ id: detail.id, phase: "active", setCount: 1 }).catch(() => undefined);
    });
    expect(s2.clearWorkout).not.toHaveBeenCalled();
  });

  it("06.7 D6 — useFinishWorkout never clears drafts itself: the landing does, once the cloud has it", async () => {
    const { qc, detail } = seeded();
    const s = stores();
    const { result } = renderHook(() => useFinishWorkout(), {
      wrapper: wrapperWithDrafts(qc, fakeClient({ finishOrQueue: async () => ({ status: "landed" as const }) }), s),
    });
    await act(() => result.current.mutateAsync({ id: detail.id, endedAt: "2026-01-01T10:00:00.000Z", meta: META }));
    expect(s.clearWorkout).not.toHaveBeenCalled();
  });
});

describe("18.0 AC25 — an own delete drops the workout's ops", () => {
  it("a successful useDeleteWorkout leaves no op of that workout in the outbox", async () => {
    const { qc, detail } = seeded();
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: fakeClient(), userId: "u1", isOnline: () => false });
    outbox.enqueueCreate({
      workoutId: detail.id,
      workoutExerciseId: detail.exercises[0]!.id,
      body: { clientGeneratedId: crypto.randomUUID(), reps: 8, isComplete: true },
    });
    outbox.enqueueCreate({ workoutId: "other", workoutExerciseId: "x", body: { clientGeneratedId: crypto.randomUUID(), reps: 1, isComplete: true } });
    const Inner = wrapperWith(qc, fakeClient({ deleteWorkout: async () => undefined }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Inner>
        <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>
      </Inner>
    );
    const { result } = renderHook(() => useDeleteWorkout(), { wrapper });
    await act(() => result.current.mutateAsync({ id: detail.id, phase: "finished", setCount: 1 }));
    expect(outbox.getState().ops.map((o) => o.workoutId)).toEqual(["other"]);
  });
});
