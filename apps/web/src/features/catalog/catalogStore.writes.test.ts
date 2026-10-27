import type { Exercise } from "@sin/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn(), track: vi.fn() }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/problem";
import { memoryStorageAdapter } from "../../storage/storage";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { createCatalogStore } from "./catalogStore";
import { catalogKey, recentsKey } from "./constants";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";
const mine = makeExercise({ id: exerciseId(1), name: "Echo Bike", ownerUserId: USER, modality: "calories" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });
const other = makeExercise({ id: exerciseId(3), name: "Plank" });

function setup(rows: Exercise[] = [mine, bench, other], recents: string[] = [exerciseId(3)]) {
  const request = vi.fn<(path: string) => Promise<unknown>>(async () => ({ exercises: [], syncToken: "1.200" }));
  const post = vi.fn<(path: string, body?: unknown, schema?: unknown) => Promise<unknown>>();
  const patch = vi.fn<(path: string, body?: unknown, schema?: unknown) => Promise<unknown>>();
  const del = vi.fn<(path: string) => Promise<unknown>>(async () => undefined);
  const storage = memoryStorageAdapter({
    [catalogKey(USER)]: JSON.stringify({ version: 1, rows, syncToken: "1.100" }),
    [recentsKey(USER)]: JSON.stringify({ version: 1, ids: recents }),
  });
  const store = createCatalogStore({
    api: { request, post, patch, delete: del } as unknown as Pick<ApiClient, "request" | "post" | "patch" | "delete">,
    storage,
    userId: USER,
  });
  const stored = () => (JSON.parse(storage.get(catalogKey(USER)) ?? "{}") as { rows: Exercise[] }).rows;
  return { store, request, post, patch, del, storage, stored };
}

const failure = new ApiError({ status: 409, type: "https://api.strengthinnumbers.app/problems/exercise-type-locked", title: "x", requestId: "req" });

beforeEach(() => {
  observability.track.mockReset();
});

describe("18.2 AC32 — store writes", () => {
  it("updateCustom merges the server's row, persists, refreshes once, tracks typeChanged", async () => {
    const { store, patch, request, stored } = setup();
    const updated = { ...mine, name: "Assault Bike", updatedAt: "2026-10-27T00:00:00.000Z" };
    patch.mockResolvedValue(updated);
    const result = await store.updateCustom(mine.id, { name: "Assault Bike" });
    expect(result).toEqual(updated);
    expect(patch).toHaveBeenCalledWith(`/v1/exercises/${mine.id}`, { name: "Assault Bike" }, expect.anything());
    expect(store.getState().rows.find((r) => r.id === mine.id)?.name).toBe("Assault Bike");
    expect(stored().find((r) => r.id === mine.id)?.name).toBe("Assault Bike");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(store.getState().recentIds).toEqual([exerciseId(3)]);
    expect(observability.track).toHaveBeenCalledWith("custom_exercise_updated", { typeChanged: false });

    patch.mockResolvedValue({ ...updated, modality: "duration" });
    await store.updateCustom(mine.id, { modality: "duration" });
    expect(observability.track).toHaveBeenLastCalledWith("custom_exercise_updated", { typeChanged: true });
  });

  it("forkExercise posts no body, merges the copy, puts it first in recents, tracks", async () => {
    const { store, post, request, stored } = setup();
    const copy = makeExercise({ id: exerciseId(9), name: "Bench Press", ownerUserId: USER, forkedFromExerciseId: bench.id });
    post.mockResolvedValue(copy);
    const result = await store.forkExercise(bench.id);
    expect(result).toEqual(copy);
    expect(post).toHaveBeenCalledWith(`/v1/exercises/${bench.id}/fork`, undefined, expect.anything());
    expect(store.getState().rows.some((r) => r.id === copy.id)).toBe(true);
    expect(stored().some((r) => r.id === copy.id)).toBe(true);
    expect(store.getState().recentIds[0]).toBe(copy.id);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(observability.track).toHaveBeenCalledWith("custom_exercise_forked");
  });

  it("deleteCustom drops the row, persists, refreshes once, leaves recents and tracks nothing", async () => {
    const { store, del, request, stored } = setup();
    await store.deleteCustom(mine.id);
    expect(del).toHaveBeenCalledWith(`/v1/exercises/${mine.id}`);
    expect(store.getState().rows.some((r) => r.id === mine.id)).toBe(false);
    expect(stored().some((r) => r.id === mine.id)).toBe(false);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(store.getState().recentIds).toEqual([exerciseId(3)]);
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("deleting an id the store does not hold still resolves", async () => {
    const { store, del } = setup();
    await expect(store.deleteCustom(exerciseId(77))).resolves.toBeUndefined();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("a rejection is the same ApiError, and the store is unchanged", async () => {
    const { store, patch, post, del } = setup();
    const before = store.getState();
    patch.mockRejectedValue(failure);
    post.mockRejectedValue(failure);
    del.mockRejectedValue(failure);
    await expect(store.updateCustom(mine.id, { modality: "duration" })).rejects.toBe(failure);
    await expect(store.forkExercise(bench.id)).rejects.toBe(failure);
    await expect(store.deleteCustom(mine.id)).rejects.toBe(failure);
    expect(store.getState().rows).toBe(before.rows);
    expect(store.getState().recentIds).toBe(before.recentIds);
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("encodes the id as one path segment", async () => {
    const { store, patch, post, del } = setup();
    patch.mockResolvedValue(mine);
    post.mockResolvedValue(mine);
    await store.updateCustom("a/b", { name: "x" });
    await store.forkExercise("a/b");
    await store.deleteCustom("a/b");
    expect(patch.mock.calls[0]![0]).toBe("/v1/exercises/a%2Fb");
    expect(post.mock.calls[0]![0]).toBe("/v1/exercises/a%2Fb/fork");
    expect(del.mock.calls[0]![0]).toBe("/v1/exercises/a%2Fb");
  });
});
