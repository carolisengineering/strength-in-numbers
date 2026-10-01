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
import { catalogKey, recentsKey } from "./constants";

const USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4c";
const OTHER_USER = "018f4e8a-1c2d-4f3a-8b6c-9d0e1f2a3b4d";

const squat = makeExercise({ id: exerciseId(1), name: "Back Squat" });
const bench = makeExercise({ id: exerciseId(2), name: "Bench Press" });

const catalogEnvelope = (rows: Exercise[], syncToken: string | null = "1.100") =>
  JSON.stringify({ version: 1, rows, syncToken });
const recentsEnvelope = (ids: string[]) => JSON.stringify({ version: 1, ids });

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
