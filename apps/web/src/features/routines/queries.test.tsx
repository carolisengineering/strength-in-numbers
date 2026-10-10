import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api";
import { exerciseId } from "../../test/catalogFixtures";
import { fakeRoutineClient, routineWrapper } from "../../test/routineHarness";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { deferred, makeQueryClient } from "../../test/workoutHarness";
import { ROUTINE_KEYS, useRoutine, useRoutines } from "./queries";
import { useCreateRoutine, useDeleteRoutine, useReplaceRoutine } from "./useRoutineMutations";

const a = makeRoutine({ id: routineId(1), name: "Push A" });
const b = makeRoutine({ id: routineId(2), name: "pull" });
const body = { name: "Legs", items: [{ exerciseId: exerciseId(1) }] };
const notFound = () => new ApiError({ status: 404, type: "https://x/problems/not-found", title: "nf", requestId: "r" });

describe("10.0 AC12 — keys and read options", () => {
  it("keys", () => {
    expect(ROUTINE_KEYS.all).toEqual(["routines"]);
    expect(ROUTINE_KEYS.list).toEqual(["routines", "list"]);
    expect(ROUTINE_KEYS.detail("x")).toEqual(["routines", "detail", "x"]);
  });

  it("useRoutines runs while offline (networkMode always) and does not retry", async () => {
    const list = vi.fn().mockRejectedValue(ApiError.network("r", null));
    const qc = makeQueryClient();
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const { result } = renderHook(() => useRoutines(), { wrapper: routineWrapper(qc, fakeRoutineClient({ list })) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(list).toHaveBeenCalledTimes(1);
    vi.restoreAllMocks();
  });
});

describe("10.0 AC12 — useRoutine reads the list first, detail only as a fallback", () => {
  it("list hit: no detail request", async () => {
    const get = vi.fn();
    const qc = makeQueryClient();
    const { result } = renderHook(() => useRoutine(routineId(2)), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ list: async () => [a, b], get })),
    });
    await waitFor(() => expect(result.current).toEqual({ status: "found", routine: b }));
    expect(get).not.toHaveBeenCalled();
  });

  it("list lacks it: detail runs; a 404 is not-found", async () => {
    const qc = makeQueryClient();
    const { result } = renderHook(() => useRoutine(routineId(9)), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ list: async () => [a], get: () => Promise.reject(notFound()) })),
    });
    await waitFor(() => expect(result.current).toEqual({ status: "not-found" }));
  });

  it("list failed: detail still serves the deep link", async () => {
    const qc = makeQueryClient();
    const { result } = renderHook(() => useRoutine(routineId(1)), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ list: () => Promise.reject(new Error("x")), get: async () => a })),
    });
    await waitFor(() => expect(result.current).toEqual({ status: "found", routine: a }));
  });

  it("suspend stops the detail fetch", async () => {
    const get = vi.fn();
    const qc = makeQueryClient();
    const { result } = renderHook(() => useRoutine(routineId(9), { suspend: true }), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ list: async () => [a], get })),
    });
    await waitFor(() => expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([a]));
    expect(result.current.status).toBe("pending");
    expect(get).not.toHaveBeenCalled();
  });
});

describe("10.0 AC12 — mutations write the caches in hook-level onSuccess", () => {
  it("create inserts sorted by lowercase name then id, and seeds detail", async () => {
    const created = makeRoutine({ id: routineId(3), name: "Legs" });
    const qc = makeQueryClient();
    qc.setQueryData(ROUTINE_KEYS.list, [b, a]); // "pull" < "push a" — server order
    const { result } = renderHook(() => useCreateRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ create: async () => created })),
    });
    await act(() => result.current.mutateAsync(body));
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([created, b, a]);
    expect(qc.getQueryData(ROUTINE_KEYS.detail(routineId(3)))).toEqual(created);
  });

  it("replace swaps in place and re-sorts; an uncached list is not created", async () => {
    const renamed = { ...a, name: "Arms" };
    const qc = makeQueryClient();
    qc.setQueryData(ROUTINE_KEYS.list, [b, a]);
    const { result } = renderHook(() => useReplaceRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ replace: async () => renamed })),
    });
    await act(() => result.current.mutateAsync({ id: a.id, body }));
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([renamed, b]);

    const empty = makeQueryClient();
    const second = renderHook(() => useReplaceRoutine(), {
      wrapper: routineWrapper(empty, fakeRoutineClient({ replace: async () => renamed })),
    });
    await act(() => second.result.current.mutateAsync({ id: a.id, body }));
    expect(empty.getQueryData(ROUTINE_KEYS.list)).toBeUndefined();
  });

  it("delete removes from both caches; a 404 counts as success", async () => {
    const qc = makeQueryClient();
    qc.setQueryData(ROUTINE_KEYS.list, [a, b]);
    qc.setQueryData(ROUTINE_KEYS.detail(a.id), a);
    const { result } = renderHook(() => useDeleteRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ remove: () => Promise.reject(notFound()) })),
    });
    await act(() => result.current.mutateAsync(a.id));
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([b]);
    expect(qc.getQueryData(ROUTINE_KEYS.detail(a.id))).toBeUndefined();
  });

  it("writes still land if the caller unmounted mid-request", async () => {
    const gate = deferred<typeof a>();
    const qc = makeQueryClient();
    qc.setQueryData(ROUTINE_KEYS.list, [b]);
    const { result, unmount } = renderHook(() => useCreateRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ create: () => gate.promise })),
    });
    const pending = result.current.mutateAsync(body);
    unmount();
    gate.resolve(a);
    await pending;
    expect(qc.getQueryData(ROUTINE_KEYS.list)).toEqual([b, a]);
  });

  it("mutations run while offline instead of pausing", async () => {
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    const qc = makeQueryClient();
    const { result } = renderHook(() => useCreateRoutine(), {
      wrapper: routineWrapper(qc, fakeRoutineClient({ create: () => Promise.reject(ApiError.network("r", null)) })),
    });
    await expect(result.current.mutateAsync(body)).rejects.toBeInstanceOf(ApiError);
    vi.restoreAllMocks();
  });
});
