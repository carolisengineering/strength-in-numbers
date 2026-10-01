import { ExerciseSchema, type Exercise } from "@sin/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ reportError: vi.fn(), track: vi.fn() }));
vi.mock("../../observability/reportError", () => ({
  reportError: observability.reportError,
}));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import type { ApiClient } from "../../api/client";
import { ApiError } from "../../api/problem";
import { memoryStorageAdapter, type StorageAdapter } from "../../storage/storage";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { createCatalogStore } from "./catalogStore";
import { CATALOG_REFRESH_STALE_MS, catalogKey, recentsKey } from "./constants";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";
const OTHER_USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4d";

const squat = makeExercise({ id: exerciseId(1), name: "Back Squat" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });

const catalogEnvelope = (rows: Exercise[], syncToken: string | null = "1.100") =>
  JSON.stringify({ version: 1, rows, syncToken });
const recentsEnvelope = (ids: string[]) => JSON.stringify({ version: 1, ids });

const apiError = (status: number) =>
  new ApiError({ status, type: "about:blank", title: `HTTP ${status}`, requestId: "req-test" });

const okBody = (exercises: Exercise[], syncToken: string) => ({ exercises, syncToken });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const seeded = (rows: Exercise[], syncToken: string | null = "1.100", recents: string[] = []) =>
  memoryStorageAdapter({
    [catalogKey(USER)]: catalogEnvelope(rows, syncToken),
    [recentsKey(USER)]: recentsEnvelope(recents),
  });

function setup(options: { storage?: StorageAdapter; userId?: string } = {}) {
  const request = vi.fn<(path: string, options?: { cache?: RequestCache }) => Promise<unknown>>();
  const post = vi.fn<(path: string, body?: unknown, schema?: unknown) => Promise<unknown>>();
  const storage = options.storage ?? memoryStorageAdapter();
  let clock = 1_000_000;
  const store = createCatalogStore({
    api: { request, post } as unknown as Pick<ApiClient, "request" | "post">,
    storage,
    userId: options.userId ?? USER,
    now: () => clock,
  });
  return {
    store,
    request,
    post,
    storage,
    clock: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

beforeEach(() => {
  observability.reportError.mockReset();
  observability.track.mockReset();
});

describe("AC9 — storage keys are versioned and per-user", () => {
  it("persists under sin:catalog:v1:<userId> and sin:recents:v1:<userId>", () => {
    const { store, storage } = setup();

    store.recordPick(exerciseId(1));

    expect(storage.get(`sin:recents:v1:${USER}`)).toBe(recentsEnvelope([exerciseId(1)]));
    expect(catalogKey(USER)).toBe(`sin:catalog:v1:${USER}`);
  });

  it("a store for one user never reads another user's rows", () => {
    const storage = memoryStorageAdapter({
      [catalogKey(OTHER_USER)]: catalogEnvelope([squat]),
      [recentsKey(OTHER_USER)]: recentsEnvelope([exerciseId(1)]),
    });

    const { store } = setup({ storage });

    expect(store.getState().rows).toEqual([]);
    expect(store.getState().recentIds).toEqual([]);
  });
});

describe("AC10 — stored data is validated on load", () => {
  it.each([
    ["a wrong version", JSON.stringify({ version: 2, rows: [], syncToken: "1.1" })],
    [
      "a row that fails ExerciseSchema",
      JSON.stringify({ version: 1, rows: [{ id: "not-an-id" }], syncToken: "1.1" }),
    ],
    ["unparsable JSON", "{not json"],
  ])("%s is discarded: empty state, key removed, one catalog_reset", (_label, raw) => {
    const storage = memoryStorageAdapter({ [catalogKey(USER)]: raw });

    const { store } = setup({ storage });

    expect(store.getState().rows).toEqual([]);
    expect(store.getState().syncToken).toBeNull();
    expect(storage.get(catalogKey(USER))).toBeNull();
    expect(observability.track).toHaveBeenCalledTimes(1);
    expect(observability.track).toHaveBeenCalledWith("catalog_reset", { reason: "corrupt" });
  });

  it("a missing key is the normal first run: empty, no event", () => {
    const { store } = setup();

    expect(store.getState().rows).toEqual([]);
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("an invalid recents value is discarded with no event", () => {
    const storage = memoryStorageAdapter({
      [catalogKey(USER)]: catalogEnvelope([squat]),
      [recentsKey(USER)]: JSON.stringify({ version: 1, ids: "nope" }),
    });

    const { store } = setup({ storage });

    expect(store.getState().recentIds).toEqual([]);
    expect(store.getState().rows).toHaveLength(1);
    expect(storage.get(recentsKey(USER))).toBeNull();
    expect(observability.track).not.toHaveBeenCalled();
  });
});

describe("AC11 — a storage failure degrades to in-memory operation, once", () => {
  const throwingStorage = (): StorageAdapter => ({
    get: () => {
      throw new Error("denied");
    },
    set: () => {
      throw new Error("denied");
    },
    remove: () => {
      throw new Error("denied");
    },
    keys: () => {
      throw new Error("denied");
    },
  });

  it("keeps working in memory and reports exactly once across many failed operations", () => {
    const { store } = setup({ storage: throwingStorage() });

    store.recordPick(exerciseId(1));
    store.recordPick(exerciseId(2));
    store.recordPick(exerciseId(3));

    expect(store.getState().recentIds).toEqual([exerciseId(3), exerciseId(2), exerciseId(1)]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.any(Error), {
      source: "catalog-storage",
    });
  });

  it("survives storage that reads fine but throws on write (quota exceeded)", () => {
    const inner = memoryStorageAdapter({ [catalogKey(USER)]: catalogEnvelope([squat]) });
    const quota: StorageAdapter = {
      ...inner,
      set: () => {
        throw new Error("QuotaExceededError");
      },
    };

    const { store } = setup({ storage: quota });
    store.recordPick(exerciseId(1));
    store.recordPick(exerciseId(2));

    expect(store.getState().rows).toHaveLength(1);
    expect(store.getState().recentIds).toEqual([exerciseId(2), exerciseId(1)]);
    expect(observability.reportError).toHaveBeenCalledTimes(1);
  });
});

describe("AC12 — cold start reads storage before touching the network", () => {
  it("reflects stored rows, token and recents with no request", () => {
    const storage = memoryStorageAdapter({
      [catalogKey(USER)]: catalogEnvelope([squat, bench], "1.100"),
      [recentsKey(USER)]: recentsEnvelope([exerciseId(2)]),
    });

    const { store, request } = setup({ storage });

    expect(store.getState()).toEqual({
      rows: [squat, bench],
      recentIds: [exerciseId(2)],
      syncToken: "1.100",
      status: "idle",
      lastRefreshAt: null,
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe("AC13 — constructing a store sweeps every other user-data key", () => {
  it("removes other users' keys and old-version keys, keeps its own and unrelated keys", () => {
    const storage = memoryStorageAdapter({
      [catalogKey(USER)]: catalogEnvelope([squat]),
      [recentsKey(USER)]: recentsEnvelope([exerciseId(1)]),
      [catalogKey(OTHER_USER)]: catalogEnvelope([bench]),
      [recentsKey(OTHER_USER)]: recentsEnvelope([exerciseId(2)]),
      [`sin:catalog:v0:${USER}`]: "{}",
      theme: "dark",
    });

    setup({ storage });

    expect(storage.keys().sort()).toEqual(
      [catalogKey(USER), recentsKey(USER), "theme"].sort(),
    );
  });
});

describe("AC21 — recents are capped at 10 and most-recent-first", () => {
  it("caps at MAX_RECENTS", () => {
    const { store } = setup();

    for (let n = 1; n <= 12; n += 1) store.recordPick(exerciseId(n));

    const { recentIds } = store.getState();
    expect(recentIds).toHaveLength(10);
    expect(recentIds[0]).toBe(exerciseId(12));
    expect(recentIds[9]).toBe(exerciseId(3));
  });

  it("moves a re-picked id to the front without growing the list", () => {
    const { store } = setup();

    store.recordPick(exerciseId(1));
    store.recordPick(exerciseId(2));
    store.recordPick(exerciseId(1));

    expect(store.getState().recentIds).toEqual([exerciseId(1), exerciseId(2)]);
  });
});

describe("AC22 — getState() is a stable snapshot", () => {
  it("returns the same reference until something changes, and a new one after recordPick", () => {
    const { store } = setup();
    const listener = vi.fn();
    store.subscribe(listener);

    const before = store.getState();
    expect(store.getState()).toBe(before);

    store.recordPick(exerciseId(1));

    expect(store.getState()).not.toBe(before);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("stops notifying after unsubscribe", () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    unsubscribe();
    store.recordPick(exerciseId(1));

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("AC14 — refresh() is a no-op when the store was refreshed recently", () => {
  it("issues one request for two calls inside the window, and another after it", async () => {
    const { store, request, advance } = setup();
    request.mockResolvedValue(okBody([squat], "1.101"));

    await store.refresh();
    await store.refresh();
    expect(request).toHaveBeenCalledTimes(1);

    advance(CATALOG_REFRESH_STALE_MS);
    await store.refresh();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("issues a request immediately after a failed refresh", async () => {
    const { store, request } = setup();
    request.mockRejectedValueOnce(apiError(500)).mockResolvedValueOnce(okBody([squat], "1.101"));

    await store.refresh();
    await store.refresh();

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("issues a request after a failed refresh even inside an earlier success's window", async () => {
    const { store, request } = setup();
    request
      .mockResolvedValueOnce(okBody([squat], "1.101"))
      .mockRejectedValueOnce(apiError(500))
      .mockResolvedValueOnce(okBody([], "1.102"));

    await store.refresh();
    await store.refresh(true);
    expect(store.getState().status).toBe("error");

    await store.refresh();

    expect(request).toHaveBeenCalledTimes(3);
    expect(store.getState().status).toBe("idle");
  });

  it("treats a clock that moved backwards as stale", async () => {
    const { store, request, advance } = setup();
    request.mockResolvedValue(okBody([squat], "1.101"));

    await store.refresh();
    advance(-60_000);
    await store.refresh();

    expect(request).toHaveBeenCalledTimes(2);
  });
});

describe("AC15 — a sync request carries the token and bypasses the HTTP cache", () => {
  it("sends since=<token>, URL-encoded, with cache: no-store", async () => {
    const { store, request } = setup({ storage: seeded([squat], "a b/1") });
    request.mockResolvedValue(okBody([], "1.101"));

    await store.refresh();

    expect(request).toHaveBeenCalledWith("/v1/exercises?since=a%20b%2F1", { cache: "no-store" });
  });

  it("omits the query when there is no stored token", async () => {
    const { store, request } = setup();
    request.mockResolvedValue(okBody([squat], "1.101"));

    await store.refresh();

    expect(request).toHaveBeenCalledWith("/v1/exercises", { cache: "no-store" });
  });
});

describe("AC16 — concurrent refreshes share one request; a forced one queues one follow-up", () => {
  it("two concurrent calls produce one request and settle together", async () => {
    const { store, request } = setup();
    const pending = deferred<unknown>();
    request.mockReturnValueOnce(pending.promise);

    const a = store.refresh();
    const b = store.refresh();
    expect(request).toHaveBeenCalledTimes(1);

    pending.resolve(okBody([squat], "1.101"));
    await Promise.all([a, b]);

    expect(store.getState().rows).toEqual([squat]);
  });

  it("forced calls during an in-flight request coalesce into exactly one follow-up", async () => {
    const { store, request } = setup();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    request.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    const initial = store.refresh();
    const forced = [store.refresh(true), store.refresh(true), store.refresh(true)];
    expect(request).toHaveBeenCalledTimes(1);

    first.resolve(okBody([squat], "1.101"));
    await initial;
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(request).toHaveBeenNthCalledWith(2, "/v1/exercises?since=1.101", {
      cache: "no-store",
    });

    second.resolve(okBody([bench], "1.102"));
    await Promise.all(forced);

    expect(request).toHaveBeenCalledTimes(2);
    expect(store.getState().rows.map((r) => r.name).sort()).toEqual([
      "Back Squat",
      "Bench Press",
    ]);
    expect(store.getState().syncToken).toBe("1.102");
  });

  it("refresh(true) skips the staleness window", async () => {
    const { store, request } = setup();
    request.mockResolvedValue(okBody([squat], "1.101"));

    await store.refresh();
    await store.refresh(true);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("never rejects, even when the request throws a non-ApiError", async () => {
    const { store, request } = setup();
    request.mockRejectedValue(new Error("boom"));

    await expect(store.refresh()).resolves.toBeUndefined();
  });
});

describe("AC17 — a delta merges; a full pull replaces", () => {
  it("a response to a since request is merged into the stored rows", async () => {
    const { store, request, storage, clock } = setup({ storage: seeded([squat, bench]) });
    const renamed = makeExercise({ id: exerciseId(2), name: "Paused Bench Press" });
    request.mockResolvedValue(okBody([renamed], "1.101"));

    await store.refresh();

    const state = store.getState();
    expect(state.rows.map((r) => r.name).sort()).toEqual(["Back Squat", "Paused Bench Press"]);
    expect(state.syncToken).toBe("1.101");
    expect(state.status).toBe("idle");
    expect(state.lastRefreshAt).toBe(clock());
    expect(JSON.parse(storage.get(catalogKey(USER)) ?? "null")).toEqual({
      version: 1,
      rows: state.rows,
      syncToken: "1.101",
    });
  });

  it("a response to a request with no since replaces the stored rows", async () => {
    const { store, request } = setup({ storage: seeded([squat, bench], null) });
    request.mockResolvedValue(okBody([bench], "1.200"));

    await store.refresh();

    expect(store.getState().rows).toEqual([bench]);
    expect(store.getState().syncToken).toBe("1.200");
  });
});

describe("AC18 — a 410/422 reset does one full pull and keeps the old rows until it lands", () => {
  it.each([
    [410, "410"],
    [422, "422"],
  ] as const)("%i → one catalog_reset, one full pull, rows replaced", async (status, reason) => {
    const { store, request } = setup({
      storage: seeded([squat], "1.100", [exerciseId(1)]),
    });
    const fullPull = deferred<unknown>();
    request.mockRejectedValueOnce(apiError(status)).mockReturnValueOnce(fullPull.promise);

    const done = store.refresh();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));

    // The old rows are still served while the full pull is in flight.
    expect(store.getState().rows).toEqual([squat]);
    expect(request).toHaveBeenNthCalledWith(2, "/v1/exercises", { cache: "no-store" });
    expect(observability.track).toHaveBeenCalledTimes(1);
    expect(observability.track).toHaveBeenCalledWith("catalog_reset", { reason });

    fullPull.resolve(okBody([bench], "1.300"));
    await done;

    expect(store.getState().rows).toEqual([bench]);
    expect(store.getState().syncToken).toBe("1.300");
    expect(store.getState().recentIds).toEqual([exerciseId(1)]);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a failed full pull keeps the rows, drops the token, and does not loop", async () => {
    const { store, request, storage } = setup({
      storage: seeded([squat], "1.100", [exerciseId(1)]),
    });
    request.mockRejectedValueOnce(apiError(410)).mockRejectedValueOnce(apiError(500));

    await store.refresh();

    const state = store.getState();
    expect(state.rows).toEqual([squat]);
    expect(state.syncToken).toBeNull();
    expect(state.status).toBe("error");
    expect(state.recentIds).toEqual([exerciseId(1)]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(JSON.parse(storage.get(catalogKey(USER)) ?? "null")).toMatchObject({
      syncToken: null,
    });
  });
});

describe("AC19 — a transient failure keeps the cached state", () => {
  it.each([
    ["a network failure", () => ApiError.network("req-test", new TypeError("offline"))],
    ["a 500", () => apiError(500)],
    ["a 401 that survived the client's retry", () => apiError(401)],
  ])("%s leaves rows, recents and token unchanged, with no reportError", async (_label, make) => {
    const { store, request } = setup({ storage: seeded([squat], "1.100", [exerciseId(1)]) });
    request.mockRejectedValue(make());

    await store.refresh();

    const state = store.getState();
    expect(state.rows).toEqual([squat]);
    expect(state.recentIds).toEqual([exerciseId(1)]);
    expect(state.syncToken).toBe("1.100");
    expect(state.status).toBe("error");
    expect(state.lastRefreshAt).toBeNull();
    expect(observability.reportError).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("a 200 with an invalid body is transient and is reported", async () => {
    const { store, request } = setup({ storage: seeded([squat], "1.100") });
    request.mockResolvedValue({ exercises: "nope" });

    await store.refresh();

    expect(store.getState().rows).toEqual([squat]);
    expect(store.getState().syncToken).toBe("1.100");
    expect(store.getState().status).toBe("error");
    expect(observability.reportError).toHaveBeenCalledTimes(1);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), {
      source: "catalog-sync-schema",
    });
  });
});

describe("AC23 — creating a custom exercise inserts locally and re-syncs", () => {
  const input = {
    name: "Zercher Squat",
    modality: "weight_reps" as const,
    primaryMuscleId: null,
    secondaryMuscleIds: [],
    equipmentId: null,
  };
  const created = makeExercise({ id: exerciseId(9), name: "Zercher Squat", ownerUserId: USER });

  it("inserts the row, records the pick, tracks, persists, and forces a refresh it does not await", async () => {
    const { store, request, post, storage } = setup({ storage: seeded([squat]) });
    post.mockResolvedValue(created);
    const background = deferred<unknown>();
    request.mockReturnValue(background.promise);

    const result = await store.createCustom(input);

    // The background refresh has not resolved, yet the row is already there.
    expect(result).toEqual(created);
    expect(post).toHaveBeenCalledWith("/v1/exercises", input, ExerciseSchema);
    expect(store.getState().rows.map((r) => r.name).sort()).toEqual([
      "Back Squat",
      "Zercher Squat",
    ]);
    expect(store.getState().recentIds[0]).toBe(exerciseId(9));
    expect(observability.track).toHaveBeenCalledWith("custom_exercise_created");
    expect(request).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.get(catalogKey(USER)) ?? "null").rows).toHaveLength(2);

    background.resolve(okBody([created], "1.101"));
    await vi.waitFor(() => expect(store.getState().syncToken).toBe("1.101"));
  });

  it("forces the refresh even inside the staleness window", async () => {
    const { store, request, post } = setup();
    request.mockResolvedValue(okBody([squat], "1.101"));
    await store.refresh();
    post.mockResolvedValue(created);

    await store.createCustom(input);

    expect(request).toHaveBeenCalledTimes(2);
  });

  it("a failed POST rejects with the ApiError and changes no state", async () => {
    const { store, request, post } = setup({ storage: seeded([squat]) });
    const failure = apiError(409);
    post.mockRejectedValue(failure);
    const before = store.getState();

    await expect(store.createCustom(input)).rejects.toBe(failure);

    expect(store.getState()).toBe(before);
    expect(request).not.toHaveBeenCalled();
    expect(observability.track).not.toHaveBeenCalled();
  });
});
