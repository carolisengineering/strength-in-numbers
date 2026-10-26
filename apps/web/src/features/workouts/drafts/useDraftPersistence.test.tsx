import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryStorageAdapter } from "../../../storage/storage";
import type { SetDraft } from "../setDraft";
import { DRAFTS_KEY, DRAFT_DEBOUNCE_MS, createDraftStores } from "./draftStore";
import { DraftStoresContext } from "./DraftStoreContext";
import { useDraftPersistence, useRestoredDraft } from "./useDraftPersistence";

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const DRAFT: SetDraft = {
  weight: "62.5", reps: "8", distance: "", minutes: "", seconds: "", rpe: "", calories: "",
  weightUnit: "kg", distanceUnit: "km", setType: "working", attemptKey: "attempt-1",
};
const setup = () => {
  const storage = memoryStorageAdapter();
  const stores = createDraftStores(storage, "u1");
  const wrapper = ({ children }: { children: ReactNode }) => <DraftStoresContext.Provider value={stores}>{children}</DraftStoresContext.Provider>;
  return { storage, stores, wrapper };
};

describe("06.5 AC6 — only an edited draft is persisted", () => {
  it("an untouched draft writes nothing", () => {
    const { storage, wrapper } = setup();
    renderHook(() => useDraftPersistence({ workoutId: "w1", workoutExerciseId: "e1", draft: DRAFT, untouched: true }), { wrapper });
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS * 2);
    expect(storage.get(DRAFTS_KEY)).toBeNull();
  });

  it("an edited draft is written once after the debounce, without attemptKey", () => {
    const { storage, wrapper } = setup();
    renderHook(() => useDraftPersistence({ workoutId: "w1", workoutExerciseId: "e1", draft: DRAFT, untouched: false }), { wrapper });
    vi.advanceTimersByTime(DRAFT_DEBOUNCE_MS);
    const value = JSON.parse(storage.get(DRAFTS_KEY)!);
    expect(value.byExercise.e1.weight).toBe("62.5");
    expect(storage.get(DRAFTS_KEY)).not.toContain("attempt-1");
  });

  it("without a provider it is a no-op", () => {
    const { result } = renderHook(() => useDraftPersistence({ workoutId: "w1", workoutExerciseId: "e1", draft: DRAFT, untouched: false }));
    expect(() => result.current.clear()).not.toThrow();
  });
});

describe("06.5 AC3 — the hook flushes when the page is hidden or left", () => {
  it.each([
    ["visibilitychange (hidden)", () => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" });
      document.dispatchEvent(new Event("visibilitychange"));
    }],
    ["pagehide", () => window.dispatchEvent(new Event("pagehide"))],
  ])("%s writes the pending value at once", (_name, fire) => {
    const { storage, wrapper } = setup();
    renderHook(() => useDraftPersistence({ workoutId: "w1", workoutExerciseId: "e1", draft: DRAFT, untouched: false }), { wrapper });
    expect(storage.get(DRAFTS_KEY)).toBeNull();
    fire();
    expect(storage.get(DRAFTS_KEY)).not.toBeNull();
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  });

  it("unmounting writes the pending value", () => {
    const { storage, wrapper } = setup();
    const view = renderHook(() => useDraftPersistence({ workoutId: "w1", workoutExerciseId: "e1", draft: DRAFT, untouched: false }), { wrapper });
    view.unmount();
    expect(storage.get(DRAFTS_KEY)).not.toBeNull();
  });
});

describe("06.5 AC7 — restore reads once, for the same workout", () => {
  it("returns the stored fields for this exercise and undefined otherwise", () => {
    const { stores, wrapper } = setup();
    const store = stores.forWorkout("w1");
    store.set("e1", { ...DRAFT });
    store.flush();
    expect(renderHook(() => useRestoredDraft("w1", "e1"), { wrapper }).result.current?.weight).toBe("62.5");
    expect(renderHook(() => useRestoredDraft("w1", "e2"), { wrapper }).result.current).toBeUndefined();
  });
});
