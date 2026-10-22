import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { fakeRoutineClient, routineWrapper } from "../../test/routineHarness";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { deferred, makeQueryClient } from "../../test/workoutHarness";
import { WORKOUT_KEYS } from "../workouts/queries";
import { ROUTINE_KEYS } from "./queries";
import { useKeepRoutine } from "./useRoutineMutations";

const zed = makeRoutine({ id: routineId(1), name: "Zed", oneOffUntil: "2026-10-30T09:00:00.000Z", createdAt: "2026-10-16T08:00:00.000Z" });
const b = makeRoutine({ id: routineId(2), name: "B" });
const c = makeRoutine({ id: routineId(3), name: "C" });
const notFound = () => new ApiError({ status: 404, type: "https://x/problems/not-found", title: "nf", requestId: "r" });

function seeded() {
  const qc = makeQueryClient();
  qc.setQueryData(ROUTINE_KEYS.list, [zed, b, c]); // the server's order: the one-off first
  qc.setQueryData(ROUTINE_KEYS.detail(zed.id), zed);
  return qc;
}

describe("10.5 AC8 — Keep's caches", () => {
  it("success patches the list and the detail, re-sorts, then revalidates the routines and the active workout", async () => {
    const qc = seeded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const keep = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() => useKeepRoutine(), { wrapper: routineWrapper(qc, fakeRoutineClient({ keep })) });
    await act(() => result.current.mutateAsync(zed.id));

    expect(keep).toHaveBeenCalledWith(zed.id);
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([b, c, { ...zed, oneOffUntil: null }]);
    expect(qc.getQueryData(ROUTINE_KEYS.detail(zed.id))).toEqual({ ...zed, oneOffUntil: null });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ROUTINE_KEYS.all });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: WORKOUT_KEYS.active });
    vi.restoreAllMocks();
  });

  it("the caches are patched before anything is invalidated", async () => {
    const qc = seeded();
    const events: string[] = [];
    const realSet = qc.setQueryData.bind(qc);
    const realInvalidate = qc.invalidateQueries.bind(qc);
    vi.spyOn(qc, "setQueryData").mockImplementation(((key: unknown, updater: unknown) => {
      events.push(`set ${JSON.stringify(key)}`);
      return realSet(key as never, updater as never);
    }) as typeof qc.setQueryData);
    vi.spyOn(qc, "invalidateQueries").mockImplementation(((filters: { queryKey: readonly unknown[] }) => {
      events.push(`invalidate ${JSON.stringify(filters.queryKey)}`);
      return realInvalidate(filters);
    }) as typeof qc.invalidateQueries);
    const { result } = renderHook(() => useKeepRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ keep: vi.fn().mockResolvedValue(undefined) })),
    });
    await act(() => result.current.mutateAsync(zed.id));
    const firstInvalidate = events.findIndex((e) => e.startsWith("invalidate"));
    expect(firstInvalidate).toBeGreaterThan(events.findLastIndex((e) => e.startsWith("set")));
    vi.restoreAllMocks();
  });

  it("the writes land even if the caller unmounted mid-request", async () => {
    const qc = seeded();
    const gate = deferred<void>();
    const { result, unmount } = renderHook(() => useKeepRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ keep: () => gate.promise })),
    });
    const pending = result.current.mutateAsync(zed.id);
    unmount();
    gate.resolve();
    await pending;
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([b, c, { ...zed, oneOffUntil: null }]);
  });

  it("a 404 is not success: it rejects, drops the detail, invalidates the list, and patches nothing", async () => {
    const qc = seeded();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = renderHook(() => useKeepRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ keep: () => Promise.reject(notFound()) })),
    });
    await act(() => expect(result.current.mutateAsync(zed.id)).rejects.toBeInstanceOf(ApiError));
    expect(qc.getQueryData(ROUTINE_KEYS.detail(zed.id))).toBeUndefined();
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ROUTINE_KEYS.list });
    expect((qc.getQueryData(ROUTINE_KEYS.list) as typeof zed[])[0]).toEqual(zed);
    vi.restoreAllMocks();
  });
});
