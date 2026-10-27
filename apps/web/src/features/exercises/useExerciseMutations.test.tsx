import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: { getAccessTokenSilently: vi.fn(), logout: vi.fn() },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { resetConfigCache } from "../../config";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { API_BASE_URL, CatalogTestProviders, seededStorage, stubWebEnv, USER_ID } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { deferred } from "../../test/workoutHarness";
import { problemResponse } from "../../test/workoutFake";
import { EXERCISE_KEYS } from "./keys";
import { applyExerciseCaches, useDeleteExercise, useForkExercise, useUpdateExercise } from "./useExerciseMutations";

const mine = makeExercise({ id: exerciseId(1), name: "Echo Bike", ownerUserId: USER_ID, modality: "calories" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });
const EX = `${API_BASE_URL}/v1/exercises`;

beforeEach(() => {
  stubWebEnv();
  auth.state.getAccessTokenSilently = vi.fn().mockResolvedValue("test-token");
  auth.state.logout = vi.fn();
  observability.track.mockReset();
  observability.reportError.mockReset();
  server.use(http.get(EX, () => HttpResponse.json({ exercises: [], syncToken: "1.200" })));
});
afterEach(() => {
  resetConfigCache();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function setup<T>(hook: () => T) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <CatalogTestProviders storage={seededStorage([mine, bench])}>{children}</CatalogTestProviders>
  );
  return renderHook(() => ({ hook: hook(), qc: useQueryClient() }), { wrapper });
}

describe("18.2 AC33 — mutation hooks", () => {
  it("applyExerciseCaches invalidates records and progress, and removes the routines read on a delete", () => {
    const qc = new QueryClient();
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const remove = vi.spyOn(qc, "removeQueries");
    applyExerciseCaches(qc, {});
    expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual([["records"], ["progress"]]);
    expect(remove).not.toHaveBeenCalled();
    applyExerciseCaches(qc, { deletedId: "x" });
    expect(remove).toHaveBeenCalledWith({ queryKey: EXERCISE_KEYS.routines("x") });
  });

  it("each mutation is online-only, never retried", async () => {
    server.use(
      http.patch(`${EX}/:id`, () => HttpResponse.json(mine)),
      http.post(`${EX}/:id/fork`, () => HttpResponse.json(mine, { status: 201 })),
      http.delete(`${EX}/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result } = setup(() => ({ update: useUpdateExercise(), fork: useForkExercise(), del: useDeleteExercise() }));
    await result.current.hook.update.mutateAsync({ id: mine.id, patch: { name: "x" } });
    await result.current.hook.fork.mutateAsync({ id: bench.id });
    await result.current.hook.del.mutateAsync({ id: mine.id, routineCount: 0 });
    const all = result.current.qc.getMutationCache().getAll();
    expect(all).toHaveLength(3);
    for (const m of all) expect(m.options).toMatchObject({ networkMode: "always", retry: false });
  });

  it("the cache helper still runs when the caller unmounted before the write landed", async () => {
    const held = deferred<void>();
    server.use(
      http.patch(`${EX}/:id`, async () => {
        await held.promise;
        return HttpResponse.json({ ...mine, name: "Assault Bike" });
      }),
    );
    const { result, unmount } = setup(() => useUpdateExercise());
    const qc = result.current.qc;
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    result.current.hook.mutate({ id: mine.id, patch: { name: "Assault Bike" } });
    unmount();
    held.resolve();
    await waitFor(() => expect(invalidate.mock.calls.map(([f]) => f?.queryKey)).toEqual(expect.arrayContaining([["records"], ["progress"]])));
  });

  it("a delete answered 404 resolves and runs the helper", async () => {
    server.use(http.delete(`${EX}/:id`, () => problemResponse(404, "not-found")));
    const { result } = setup(() => useDeleteExercise());
    const remove = vi.spyOn(result.current.qc, "removeQueries");
    await expect(result.current.hook.mutateAsync({ id: mine.id, routineCount: 2 })).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith({ queryKey: EXERCISE_KEYS.routines(mine.id) });
  });
});

describe("18.2 AC53 — telemetry", () => {
  it("exact events on success, nothing on failure", async () => {
    server.use(
      http.patch(`${EX}/:id`, () => HttpResponse.json(mine)),
      http.post(`${EX}/:id/fork`, () => HttpResponse.json({ ...bench, id: exerciseId(9), ownerUserId: USER_ID, forkedFromExerciseId: bench.id }, { status: 201 })),
      http.delete(`${EX}/:id`, () => new HttpResponse(null, { status: 204 })),
    );
    const { result } = setup(() => ({ update: useUpdateExercise(), fork: useForkExercise(), del: useDeleteExercise() }));
    await result.current.hook.update.mutateAsync({ id: mine.id, patch: { modality: "duration" } });
    await result.current.hook.fork.mutateAsync({ id: bench.id });
    await result.current.hook.del.mutateAsync({ id: mine.id, routineCount: 3 });
    expect(observability.track.mock.calls).toEqual([
      ["custom_exercise_updated", { typeChanged: true }],
      ["custom_exercise_forked"],
      ["custom_exercise_deleted", { routineCount: 3 }],
    ]);

    observability.track.mockReset();
    server.use(
      http.patch(`${EX}/:id`, () => problemResponse(409, "exercise-type-locked")),
      http.post(`${EX}/:id/fork`, () => problemResponse(409, "exercise-limit-reached")),
      http.delete(`${EX}/:id`, () => problemResponse(500, "internal")),
    );
    await expect(result.current.hook.update.mutateAsync({ id: mine.id, patch: { modality: "duration" } })).rejects.toBeTruthy();
    await expect(result.current.hook.fork.mutateAsync({ id: bench.id })).rejects.toBeTruthy();
    await expect(result.current.hook.del.mutateAsync({ id: mine.id, routineCount: 1 })).rejects.toBeTruthy();
    expect(observability.track).not.toHaveBeenCalled();
    expect(observability.reportError).not.toHaveBeenCalled();
  });
});
