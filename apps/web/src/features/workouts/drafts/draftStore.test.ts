import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  blockUserDataWrites,
  localStorageAdapter,
  memoryStorageAdapter,
  resetUserDataWritesForTests,
  type StorageAdapter,
} from "../../../storage/storage";
import { DRAFTS_KEY, DRAFT_DEBOUNCE_MS, clearWorkoutDrafts, createDraftStore, createDraftStores, type DraftFields } from "./draftStore";

const FIELDS: DraftFields = {
  weight: "62.5",
  reps: "8",
  distance: "",
  minutes: "",
  seconds: "",
  rpe: "",
  weightUnit: "kg",
  distanceUnit: "km",
  setType: "working",
};
const USER = "u1";
const WORKOUT = "w1";
const EX = "e1";

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  resetUserDataWritesForTests();
});

const stored = (storage: StorageAdapter) => {
  const raw = storage.get(DRAFTS_KEY);
  return raw === null ? null : JSON.parse(raw);
};
const make = (storage: StorageAdapter = memoryStorageAdapter(), report = vi.fn()) => ({
  storage,
  report,
  store: createDraftStore({ storage, userId: USER, workoutId: WORKOUT, report }),
});

describe("06.5 AC1 — a draft round-trips through storage", () => {
  it("writes exactly the nine fields under one key, never attemptKey, and a fresh store reads them back", () => {
    const { storage, store } = make();
    store.set(EX, { ...FIELDS, attemptKey: "must-not-be-written" } as DraftFields);
    store.flush();
    expect(stored(storage)).toEqual({ v: 1, userId: USER, workoutId: WORKOUT, byExercise: { [EX]: FIELDS } });
    expect(storage.get(DRAFTS_KEY)).not.toContain("attemptKey");
    const again = createDraftStore({ storage, userId: USER, workoutId: WORKOUT, report: vi.fn() });
    expect(again.get(EX)).toEqual(FIELDS);
  });
});

describe("06.5 AC2 — restore is for the same user and workout, and shape-checked", () => {
  const seed = (value: unknown) => memoryStorageAdapter({ [DRAFTS_KEY]: typeof value === "string" ? value : JSON.stringify(value) });
  const good = { v: 1, userId: USER, workoutId: WORKOUT, byExercise: { [EX]: FIELDS } };

  it("accepts a good value", () => {
    const { store, report } = make(seed(good));
    expect(store.get(EX)).toEqual(FIELDS);
    expect(report).not.toHaveBeenCalled();
  });

  it.each([
    ["malformed JSON", "{not json"],
    ["a wrong version", { ...good, v: 2 }],
    ["an array", []],
    ["a number where a string belongs", { ...good, byExercise: { [EX]: { ...FIELDS, weight: 62.5 } } }],
    ["an unknown unit", { ...good, byExercise: { [EX]: { ...FIELDS, weightUnit: "stone" } } }],
  ])("drops %s, removes the key and reports once (Review Focus 1)", (_name, value) => {
    const storage = seed(value);
    const { store, report } = make(storage);
    expect(store.get(EX)).toBeUndefined();
    expect(storage.get(DRAFTS_KEY)).toBeNull();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("a __proto__ key in byExercise cannot pollute anything", () => {
    const raw = `{"v":1,"userId":"${USER}","workoutId":"${WORKOUT}","byExercise":{"__proto__":${JSON.stringify(FIELDS)}}}`;
    const { store } = make(seed(raw));
    expect(({} as Record<string, unknown>).weight).toBeUndefined();
    expect(store.get(EX)).toBeUndefined();
  });

  it("drops another user's value silently", () => {
    const storage = seed({ ...good, userId: "someone-else" });
    const { store, report } = make(storage);
    expect(store.get(EX)).toBeUndefined();
    expect(storage.get(DRAFTS_KEY)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });

  it("drops another workout's value silently (Review Focus 3)", () => {
    const storage = seed({ ...good, workoutId: "w-old" });
    const { store, report } = make(storage);
    expect(store.get(EX)).toBeUndefined();
    expect(storage.get(DRAFTS_KEY)).toBeNull();
    expect(report).not.toHaveBeenCalled();
  });
});

describe("06.5 AC3 — writes are debounced and flushed", () => {
  it("three sets within 300 ms make one write with the latest values", () => {
    const storage = memoryStorageAdapter();
    const spy = vi.spyOn(storage, "set");
    const { store } = make(storage);
    store.set(EX, { ...FIELDS, reps: "1" });
    vi.advanceTimersByTime(100);
    store.set(EX, { ...FIELDS, reps: "2" });
    vi.advanceTimersByTime(100);
    store.set(EX, { ...FIELDS, reps: "3" });
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(stored(storage).byExercise[EX].reps).toBe("3");
  });

  it("flush() writes a pending value at once and cancels the timer", () => {
    const storage = memoryStorageAdapter();
    const spy = vi.spyOn(storage, "set");
    const { store } = make(storage);
    store.set(EX, FIELDS);
    store.flush();
    expect(spy).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("flush() with nothing pending writes nothing", () => {
    const storage = memoryStorageAdapter();
    const spy = vi.spyOn(storage, "set");
    make(storage).store.flush();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("06.5 AC4 — a storage failure is reported once and never thrown", () => {
  it("set throwing keeps serving from memory, reports once, never throws (Review Focus 2)", () => {
    const storage = memoryStorageAdapter();
    vi.spyOn(storage, "set").mockImplementation(() => {
      throw new Error("quota");
    });
    const { store, report } = make(storage);
    expect(() => {
      store.set(EX, FIELDS);
      store.flush();
      store.set(EX, { ...FIELDS, reps: "9" });
      store.flush();
    }).not.toThrow();
    expect(store.get(EX)?.reps).toBe("9");
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("get throwing is treated as no value, reported once", () => {
    const storage = memoryStorageAdapter();
    vi.spyOn(storage, "get").mockImplementation(() => {
      throw new Error("denied");
    });
    const { store, report } = make(storage);
    expect(store.get(EX)).toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });
});

describe("06.5 AC5 — nothing is written after the logout write block", () => {
  it("a pending timer, flush() and a later set leave no key behind", () => {
    const storage = localStorageAdapter();
    storage.remove(DRAFTS_KEY);
    const { store } = make(storage);
    store.set(EX, FIELDS); // pending debounce
    blockUserDataWrites(); // logoutAndClear's first step
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    store.flush();
    store.set(EX, { ...FIELDS, reps: "9" });
    store.flush();
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });
});

describe("06.5 AC10 — a workout ending drops its drafts", () => {
  it("clearExercise removes one entry at once and removes the key when none is left", () => {
    const { storage, store } = make();
    store.set(EX, FIELDS);
    store.set("e2", FIELDS);
    store.flush();
    store.clearExercise(EX);
    expect(Object.keys(stored(storage).byExercise)).toEqual(["e2"]);
    store.clearExercise("e2");
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });

  it("clearExercise cancels a pending debounce for that exercise", () => {
    const { storage, store } = make();
    store.set(EX, FIELDS);
    store.clearExercise(EX);
    vi.advanceTimersByTime(1000);
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });

  it("clearWorkout removes the key for its own workout and ignores another's", () => {
    const { storage, store } = make();
    store.set(EX, FIELDS);
    store.flush();
    store.clearWorkout("w-other");
    expect(storage.get(DRAFTS_KEY)).not.toBeNull();
    store.clearWorkout(WORKOUT);
    expect(storage.get(DRAFTS_KEY)).toBeNull();
    expect(store.get(EX)).toBeUndefined();
  });

  it("clearWorkoutDrafts removes a stored value only when it belongs to that workout", () => {
    const storage = memoryStorageAdapter({ [DRAFTS_KEY]: JSON.stringify({ v: 1, userId: USER, workoutId: WORKOUT, byExercise: {} }) });
    clearWorkoutDrafts(storage, "w-other");
    expect(storage.get(DRAFTS_KEY)).not.toBeNull();
    clearWorkoutDrafts(storage, WORKOUT);
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });

  it("an orphan entry is ignored on restore and pruned by retainOnly on the next write", () => {
    const { storage, store } = make();
    store.set(EX, FIELDS);
    store.set("gone", FIELDS);
    store.flush();
    store.retainOnly(new Set([EX]));
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    expect(Object.keys(stored(storage).byExercise)).toEqual([EX]);
    expect(store.get("gone")).toBeUndefined();
  });
});

describe("06.5 AC11 — drafts follow the user and the workout", () => {
  it("createDraftStores hands back one store per workout and replaces the old one", () => {
    const storage = memoryStorageAdapter();
    const stores = createDraftStores(storage, USER);
    const a = stores.forWorkout("w1");
    expect(stores.forWorkout("w1")).toBe(a);
    a.set(EX, FIELDS);
    const b = stores.forWorkout("w2"); // disposing a flushes it first, then w2's load drops w1's value
    expect(b.get(EX)).toBeUndefined(); // one workout only (Review Focus 3)
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });

  it("DraftStores.clearWorkout reaches a workout that has no cached store", () => {
    const storage = memoryStorageAdapter({ [DRAFTS_KEY]: JSON.stringify({ v: 1, userId: USER, workoutId: "w9", byExercise: {} }) });
    createDraftStores(storage, USER).clearWorkout("w9");
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });
});
