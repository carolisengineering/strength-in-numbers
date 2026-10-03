import { afterEach, describe, expect, it, vi } from "vitest";
import { memoryStorageAdapter } from "../../../storage/storage";
import { createOutbox, OUTBOX_KEY } from "./outbox";

const KEY = "30000000-0000-4000-8000-000000000001";
afterEach(() => vi.restoreAllMocks());

describe("06.2 AC19 — two tabs cannot corrupt the outbox", () => {
  it("another tab's write sets conflict, stops sending and stops saving", async () => {
    const storage = memoryStorageAdapter();
    const setSpy = vi.spyOn(storage, "set");
    const rest = { createSet: vi.fn(), updateSet: vi.fn(), deleteSet: vi.fn() };
    const outbox = createOutbox({ storage, rest, userId: "u1", isOnline: () => false });
    const stop = outbox.start();

    window.dispatchEvent(new StorageEvent("storage", { key: OUTBOX_KEY, newValue: "{}", storageArea: window.localStorage }));
    expect(outbox.getState().conflict).toBe(true);

    const writes = setSpy.mock.calls.length;
    outbox.enqueueCreate({ workoutId: "w", workoutExerciseId: "we", body: { clientGeneratedId: KEY, reps: 1, isComplete: true } });
    await outbox.drain({ force: true });
    expect(setSpy.mock.calls.length).toBe(writes);
    expect(rest.createSet).not.toHaveBeenCalled();
    stop();
  });

  it("after stop() another tab's write is ignored", () => {
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: { createSet: vi.fn(), updateSet: vi.fn(), deleteSet: vi.fn() }, userId: "u1" });
    outbox.start()();
    window.dispatchEvent(new StorageEvent("storage", { key: OUTBOX_KEY, newValue: "{}", storageArea: window.localStorage }));
    expect(outbox.getState().conflict).toBe(false);
  });
});
