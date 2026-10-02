import type { Exercise } from "@sin/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn(), track: vi.fn() }));
vi.mock("../../observability/reportError", () => ({
  reportError: observability.reportError,
}));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import type { ApiClient } from "../../api/client";
import { memoryStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { createCatalogStore } from "./catalogStore";
import { MAX_RECENTS, catalogKey, recentsKey } from "./constants";

/**
 * Spec 06.4 Phase B (BL-12): what the catalog store does when a refresh response lands after a write
 * made while the request was in flight. Same deferred-promise pattern as 06.0 AC16's tests.
 */

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";

const squat = makeExercise({ id: exerciseId(1), name: "Back Squat" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });
const created = makeExercise({ id: exerciseId(9), name: "Zercher Squat", ownerUserId: USER });
const input = {
  name: "Zercher Squat",
  modality: "weight_reps" as const,
  primaryMuscleId: null,
  secondaryMuscleIds: [],
  equipmentId: null,
};

const okBody = (exercises: Exercise[], syncToken: string) => ({ exercises, syncToken });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const seeded = (rows: Exercise[], syncToken: string | null, recents: string[] = []) => ({
  [catalogKey(USER)]: JSON.stringify({ version: 1, rows, syncToken }),
  [recentsKey(USER)]: JSON.stringify({ version: 1, ids: recents }),
});

/** Memory storage whose `set` can be made to throw from a chosen moment on. */
function switchableStorage(initial: Record<string, string> = {}) {
  const inner = memoryStorageAdapter(initial);
  let failing = false;
  const storage: StorageAdapter = {
    ...inner,
    set: (key, value) => {
      if (failing) throw new Error("QuotaExceededError");
      inner.set(key, value);
    },
  };
  return { storage, failFromNowOn: () => (failing = true) };
}

function setup(storage: StorageAdapter) {
  const request = vi.fn<(path: string, options?: { cache?: RequestCache }) => Promise<unknown>>();
  const post = vi.fn<(path: string, body?: unknown, schema?: unknown) => Promise<unknown>>();
  const store = createCatalogStore({
    api: { request, post } as unknown as Pick<ApiClient, "request" | "post">,
    storage,
    userId: USER,
    now: () => 1_000_000,
  });
  return { store, request, post };
}

const persistedRows = (storage: StorageAdapter) =>
  (JSON.parse(storage.get(catalogKey(USER)) ?? "null") as { rows: Exercise[] }).rows.map((r) => r.id);
const persistedRecents = (storage: StorageAdapter) =>
  (JSON.parse(storage.get(recentsKey(USER)) ?? "null") as { ids: string[] }).ids;

beforeEach(() => {
  observability.reportError.mockReset();
  observability.track.mockReset();
});

describe("06.4 AC12 — createCustom resolving during an in-flight delta refresh keeps the new row", () => {
  it("the delta merges around the created row; recents and storage keep it", async () => {
    const storage = memoryStorageAdapter(seeded([squat], "1.100"));
    const { store, request, post } = setup(storage);
    const delta = deferred<unknown>();
    request.mockReturnValueOnce(delta.promise).mockResolvedValue(okBody([], "1.102"));
    post.mockResolvedValue(created);

    const refreshing = store.refresh();
    await store.createCustom(input);
    delta.resolve(okBody([bench], "1.101")); // predates the created row
    await refreshing;

    // At the moment the delta lands, before the follow-up createCustom queued:
    expect(store.getState().rows.map((r) => r.id).sort()).toEqual([squat.id, bench.id, created.id].sort());
    expect(store.getState().recentIds[0]).toBe(created.id);
    expect(persistedRows(storage)).toContain(created.id);

    await vi.waitFor(() => expect(store.getState().syncToken).toBe("1.102"));
    expect(store.getState().rows.map((r) => r.id)).toContain(created.id);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[0]![0]).toBe("/v1/exercises?since=1.100");
  });
});

describe("06.4 AC13 — createCustom resolving during an in-flight full pull converges", () => {
  it("the follow-up createCustom queued brings the row back; two GETs in all", async () => {
    const storage = memoryStorageAdapter();
    const { store, request, post } = setup(storage);
    const full = deferred<unknown>();
    request.mockReturnValueOnce(full.promise).mockResolvedValueOnce(okBody([created], "1.101"));
    post.mockResolvedValue(created);

    const refreshing = store.refresh(); // first load: no token, a full pull
    await store.createCustom(input);
    full.resolve(okBody([squat], "1.100")); // predates the created row
    await refreshing;

    // Between the two responses the full pull's replace (06.0 AC17) drops the row: transient and
    // accepted (Spec 06.4 D5). If the store is ever made to keep rows inserted mid-flight, this line
    // flips to `toContain` and 06.0 AC17 gains a sentence.
    expect(store.getState().rows.map((r) => r.id)).not.toContain(created.id);
    expect(store.getState().recentIds).toEqual([created.id]);

    await vi.waitFor(() => expect(store.getState().syncToken).toBe("1.101"));
    expect(store.getState().rows.map((r) => r.id).sort()).toEqual([squat.id, created.id].sort());
    expect(store.getState().recentIds).toEqual([created.id]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.map(([path]) => path)).toEqual(["/v1/exercises", "/v1/exercises?since=1.100"]);
  });
});

describe("06.4 AC14 — a refresh response landing after recordPick keeps recents", () => {
  it.each([
    ["delta", "1.100" as string | null, "/v1/exercises?since=1.100"],
    ["full pull", null, "/v1/exercises"],
  ])("%s", async (_label, token, path) => {
    const storage = memoryStorageAdapter(seeded([squat], token, [squat.id]));
    const { store, request } = setup(storage);
    const response = deferred<unknown>();
    request.mockReturnValueOnce(response.promise);

    const refreshing = store.refresh();
    store.recordPick(bench.id);
    const picked = store.getState().recentIds;
    response.resolve(okBody([squat, bench], "1.101"));
    await refreshing;

    expect(request.mock.calls[0]![0]).toBe(path);
    expect(store.getState().recentIds).toEqual(picked);
    expect(store.getState().recentIds).toEqual([bench.id, squat.id]);
    expect(persistedRecents(storage)).toEqual(store.getState().recentIds);
  });

  it("a pick that evicts the tenth entry mid-flight stays evicted, capped at 10", async () => {
    const ten = Array.from({ length: MAX_RECENTS }, (_, i) => exerciseId(100 + i));
    const storage = memoryStorageAdapter(seeded([squat], "1.100", ten));
    const { store, request } = setup(storage);
    const response = deferred<unknown>();
    request.mockReturnValueOnce(response.promise);

    const refreshing = store.refresh();
    store.recordPick(bench.id);
    response.resolve(okBody([bench], "1.101"));
    await refreshing;

    const expected = [bench.id, ...ten.slice(0, MAX_RECENTS - 1)];
    expect(store.getState().recentIds).toEqual(expected);
    expect(store.getState().recentIds).not.toContain(ten[MAX_RECENTS - 1]);
    expect(persistedRecents(storage)).toEqual(expected);
  });
});

describe("06.4 AC15 — a storage failure in the middle of an interleaving degrades once and loses nothing", () => {
  it("overlapping createCustom: reported once, memory correct, later calls still work", async () => {
    const { storage, failFromNowOn } = switchableStorage(seeded([squat], "1.100"));
    const { store, request, post } = setup(storage);
    const delta = deferred<unknown>();
    const followUp = deferred<unknown>(); // the refresh createCustom queues, held so the state between is visible
    request.mockReturnValueOnce(delta.promise).mockReturnValueOnce(followUp.promise).mockResolvedValue(okBody([], "1.103"));
    post.mockResolvedValue(created);

    const refreshing = store.refresh();
    await store.createCustom(input);
    failFromNowOn();
    delta.resolve(okBody([bench], "1.101"));
    await expect(refreshing).resolves.toBeUndefined();

    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.any(Error), { source: "catalog-storage" });
    expect(store.getState().rows.map((r) => r.id).sort()).toEqual([squat.id, bench.id, created.id].sort());
    expect(store.getState().syncToken).toBe("1.101");
    expect(store.getState().recentIds[0]).toBe(created.id);

    // Later operations keep working from memory, with no second report.
    followUp.resolve(okBody([], "1.102"));
    await vi.waitFor(() => expect(store.getState().syncToken).toBe("1.102"));
    const another = makeExercise({ id: exerciseId(10), name: "Pin Press", ownerUserId: USER });
    post.mockResolvedValue(another);
    await expect(store.createCustom({ ...input, name: "Pin Press" })).resolves.toEqual(another);
    await store.refresh(true);
    expect(store.getState().rows.map((r) => r.id)).toContain(another.id);
    expect(store.getState().recentIds.slice(0, 2)).toEqual([another.id, created.id]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });

  it("overlapping recordPick: reported once, recents and rows correct, later picks still work", async () => {
    const { storage, failFromNowOn } = switchableStorage(seeded([squat], "1.100", [squat.id]));
    const { store, request } = setup(storage);
    const delta = deferred<unknown>();
    request.mockReturnValueOnce(delta.promise).mockResolvedValue(okBody([], "1.102"));

    const refreshing = store.refresh();
    store.recordPick(bench.id);
    failFromNowOn();
    delta.resolve(okBody([bench], "1.101"));
    await expect(refreshing).resolves.toBeUndefined();

    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(store.getState().recentIds).toEqual([bench.id, squat.id]);
    expect(store.getState().rows.map((r) => r.id).sort()).toEqual([squat.id, bench.id].sort());
    expect(store.getState().syncToken).toBe("1.101");

    expect(() => store.recordPick(squat.id)).not.toThrow();
    expect(store.getState().recentIds).toEqual([squat.id, bench.id]);
    await store.refresh(true);
    expect(store.getState().syncToken).toBe("1.102");
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });
});
