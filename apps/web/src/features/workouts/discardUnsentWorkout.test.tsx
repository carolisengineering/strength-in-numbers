import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { memoryStorageAdapter } from "../../storage/storage";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { fakeClient } from "../../test/workoutHarness";
import { createDraftStores } from "./drafts/draftStore";
import { DraftStoresContext } from "./drafts/DraftStoreContext";
import { createOutbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import type { FinishOp, OutboxOp } from "./outbox/ops";
import { WORKOUT_KEYS } from "./queries";
import { createRestStores } from "./restStore";
import { useRestStores, RestStoresContext } from "./useRestTimer";
import { useDiscardUnsentWorkout } from "./useWorkoutMutations";

afterEach(() => observability.track.mockReset());

const GONE = "10000000-0000-4000-8000-0000000000aa";
const OTHER = "10000000-0000-4000-8000-0000000000bb";
const finishOp = (workoutId: string): FinishOp => ({
  id: `finish-${workoutId}`,
  workoutId,
  userId: "u1",
  status: "failed",
  failure: { status: 404, type: "about:blank", requestId: "r" },
  attempted: true,
  attempts: 1,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "finish",
  body: { endedAt: "2026-11-08T10:15:00.000Z" },
  meta: { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 2, setCount: 7, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
});
const createOp = (workoutId: string, key: string): OutboxOp => ({
  id: `create-${key}`,
  workoutId,
  workoutExerciseId: "we",
  userId: "u1",
  status: "queued",
  attempted: false,
  attempts: 0,
  nextAttemptAt: 0,
  enqueuedAt: 0,
  kind: "create",
  target: { clientGeneratedId: key },
  body: { clientGeneratedId: key, reps: 5, isComplete: true },
});

function setup() {
  const storage = memoryStorageAdapter();
  const queryClient = new QueryClient();
  const outbox = createOutbox({ storage, rest: fakeClient(), userId: "u1", isOnline: () => false });
  outbox.__setForTests([createOp(GONE, "k1"), createOp(OTHER, "k2"), finishOp(GONE)]);
  const drafts = createDraftStores(storage, "u1");
  const rest = createRestStores(storage, "u1");
  const draftsClear = vi.spyOn(drafts, "clearWorkout");
  const restClear = vi.spyOn(rest, "clearWorkout");
  queryClient.setQueryData(WORKOUT_KEYS.detail(GONE), makeWorkoutDetail({ id: GONE }));
  queryClient.setQueryData(WORKOUT_KEYS.detail(OTHER), makeWorkoutDetail({ id: OTHER }));
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <OutboxContext.Provider value={outbox}>
        <DraftStoresContext.Provider value={drafts}>
          <RestStoresContext.Provider value={rest}>{children}</RestStoresContext.Provider>
        </DraftStoresContext.Provider>
      </OutboxContext.Provider>
    </QueryClientProvider>
  );
  const { result } = renderHook(() => ({ discard: useDiscardUnsentWorkout(), rest: useRestStores() }), { wrapper });
  return { outbox, queryClient, draftsClear, restClear, discard: result.current.discard };
}

describe("06.7 AC20 — a workout gone from the server can be dropped, once", () => {
  it("removes its ops and id-map entries, its drafts and rest timer, its detail cache, and tracks workout_discarded { phase: 'unsent' }", () => {
    const t = setup();
    t.discard(GONE);
    expect(t.outbox.getState().ops.map((o) => o.workoutId)).toEqual([OTHER]);
    expect(t.draftsClear).toHaveBeenCalledWith(GONE);
    expect(t.restClear).toHaveBeenCalledWith(GONE);
    expect(t.queryClient.getQueryState(WORKOUT_KEYS.detail(GONE))).toBeUndefined();
    expect(t.queryClient.getQueryData(WORKOUT_KEYS.detail(OTHER))).toBeDefined();
    expect(observability.track.mock.calls).toEqual([["workout_discarded", { phase: "unsent", setCount: 7 }]]);
  });

  it("a second discard of the same workout does nothing more", () => {
    const t = setup();
    t.discard(GONE);
    t.discard(GONE);
    expect(observability.track).toHaveBeenCalledOnce();
  });
});
