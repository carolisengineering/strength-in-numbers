import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../api";
import { routineId } from "../../test/workoutFixtures";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { WorkoutSchema } from "@sin/core";
import { useBeginWorkout } from "./useBeginWorkout";
import type { ReactNode } from "react";
import { memoryStorageAdapter } from "../../storage/storage";
import { START_BLOCKED_MESSAGE } from "./messages";
import { createOutbox } from "./outbox/outbox";
import { OutboxContext } from "./outbox/OutboxContext";
import type { FinishOp } from "./outbox/ops";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
});

const workout = WorkoutSchema.parse(makeWorkoutDetail());
const conflict = (type: string, status = 409) => new ApiError({ status, type: `https://x/problems/${type}`, title: type, requestId: "r1" });

function setup(start: ReturnType<typeof vi.fn>, options?: { routineId?: string }) {
  const qc = makeQueryClient();
  const client = fakeClient({ start, getActive: async () => null });
  return renderHook(() => useBeginWorkout(options), { wrapper: wrapperWith(qc, client) });
}

describe("10.0 AC13 — useBeginWorkout keeps the idempotent start", () => {
  it("an empty start sends today's body and tracks fromRoutine false", async () => {
    const start = vi.fn().mockResolvedValue(workout);
    const { result } = setup(start);
    await act(async () => expect(await result.current.begin()).toEqual({ kind: "started" }));
    const body = start.mock.calls[0]![0];
    expect(Object.keys(body).sort()).toEqual(["clientGeneratedId", "startedAt", "tzOffsetMinutes"]);
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: false, fromRoutine: false });
  });

  it("a routine start adds routineId and tracks fromRoutine true, no id", async () => {
    const start = vi.fn().mockResolvedValue(workout);
    const { result } = setup(start, { routineId: routineId(4) });
    await act(() => result.current.begin());
    expect(start.mock.calls[0]![0]).toMatchObject({ routineId: routineId(4) });
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: false, fromRoutine: true });
  });

  it("retries reuse the key", async () => {
    const start = vi.fn().mockRejectedValueOnce(ApiError.network("n", null)).mockResolvedValue(workout);
    const { result } = setup(start);
    await act(async () => expect((await result.current.begin())?.kind).toBe("failed"));
    expect(result.current.failure?.kind).toBe("network");
    await act(() => result.current.begin());
    const keys = start.mock.calls.map((c) => c[0].clientGeneratedId);
    expect(keys[0]).toBe(keys[1]);
  });

  it("a second call while in flight sends nothing", async () => {
    const gate = deferred<typeof workout>();
    const start = vi.fn().mockReturnValue(gate.promise);
    const { result } = setup(start);
    let second: unknown;
    await act(async () => {
      const first = result.current.begin();
      second = await result.current.begin();
      gate.resolve(workout);
      await first;
    });
    expect(second).toBeNull();
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("409 workout-in-progress-exists adopts and tracks resumed", async () => {
    const start = vi.fn().mockRejectedValue(conflict("workout-in-progress-exists"));
    const { result } = setup(start, { routineId: routineId(1) });
    await act(async () => expect(await result.current.begin()).toEqual({ kind: "resumed" }));
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: true, fromRoutine: true });
  });

  it("a late second tap after success replays the same key (no new workout, no false resume)", async () => {
    const start = vi.fn().mockResolvedValue(workout);
    const { result } = setup(start);
    await act(async () => expect(await result.current.begin()).toEqual({ kind: "started" }));
    await act(async () => expect(await result.current.begin()).toEqual({ kind: "started" }));
    const [first, second] = start.mock.calls.map((c) => c[0].clientGeneratedId);
    expect(second).toBe(first);
  });

  it("other failures come back classified", async () => {
    const start = vi.fn().mockRejectedValue(conflict("exercise-retired"));
    const { result } = setup(start, { routineId: routineId(1) });
    await act(async () => expect(await result.current.begin()).toMatchObject({ kind: "failed", failure: { kind: "exercise-retired" } }));
  });
});

describe("06.7 AC18 — starting is blocked while a finish waits", () => {
  const finishOp = (status: FinishOp["status"]): FinishOp => ({
    id: "finish-1",
    workoutId: "w-finished",
    userId: "u1",
    status,
    attempted: false,
    attempts: 0,
    nextAttemptAt: 0,
    enqueuedAt: 0,
    kind: "finish",
    body: { endedAt: "2026-11-08T10:15:00.000Z" },
    meta: { startedAt: "2026-11-08T09:00:00.000Z", exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
  });

  function setupWithFinish(start: ReturnType<typeof vi.fn>, status: FinishOp["status"] | null, options?: { routineId?: string }) {
    const qc = makeQueryClient();
    const client = fakeClient({ start, getActive: async () => null });
    const outbox = createOutbox({ storage: memoryStorageAdapter(), rest: client, userId: "u1", isOnline: () => false });
    if (status) outbox.__setForTests([finishOp(status)]);
    const Base = wrapperWith(qc, client);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <Base>
        <OutboxContext.Provider value={outbox}>{children}</OutboxContext.Provider>
      </Base>
    );
    return renderHook(() => useBeginWorkout(options), { wrapper });
  }

  it.each([
    ["the Start screen's", undefined],
    ["a routine preview's", { routineId: routineId(2) }],
  ])("%s Start returns blocked with no request while a finish op exists, in any status", async (_name, options) => {
    for (const status of ["queued", "sending", "failed"] as const) {
      const start = vi.fn().mockResolvedValue(workout);
      const { result, unmount } = setupWithFinish(start, status, options);
      await act(async () => expect(await result.current.begin()).toEqual({ kind: "blocked", message: START_BLOCKED_MESSAGE }));
      expect(start).not.toHaveBeenCalled();
      unmount();
    }
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("with no finish op it starts as before", async () => {
    const start = vi.fn().mockResolvedValue(workout);
    const { result } = setupWithFinish(start, null);
    await act(async () => expect(await result.current.begin()).toEqual({ kind: "started" }));
    expect(start).toHaveBeenCalledOnce();
  });
});
