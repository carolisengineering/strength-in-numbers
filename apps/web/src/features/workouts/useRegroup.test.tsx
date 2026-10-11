import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LINK_CAP_MESSAGE, type SessionSlot } from "@sin/core";

const tracked = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: tracked.track }));

import { ApiError } from "../../api";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import { WORKOUT_KEYS } from "./queries";
import { NO_FREE_GROUP_MESSAGE, useRegroup } from "./useRegroup";
import type { WorkoutClient } from "./workoutClient";

afterEach(() => tracked.track.mockReset());

const slots = (...groups: (number | null)[]): SessionSlot[] => groups.map((group, i) => ({ id: `we${i}`, group }));
const boom = () => new ApiError({ status: 500, type: "about:blank", title: "x", requestId: "r" });

function setup(update: WorkoutClient["updateWorkoutExercise"]) {
  const qc = makeQueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const hook = renderHook(() => useRegroup(), { wrapper: wrapperWith(qc, fakeClient({ updateWorkoutExercise: update })) });
  return { qc, invalidate, ...hook };
}

describe("10.1 AC12 — sequential sending", () => {
  it("the next PATCH starts only after the previous resolves; one invalidate at the end", async () => {
    const gates = [deferred<unknown>(), deferred<unknown>()];
    const calls: [string, unknown][] = [];
    const update = vi.fn((id: string, body: unknown) => {
      calls.push([id, body]);
      return gates[calls.length - 1]!.promise;
    }) as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result, invalidate } = setup(update);

    let outcome!: ReturnType<typeof result.current.run>;
    act(() => {
      outcome = result.current.run(slots(null, null), { type: "toggleLink", index: 0 });
    });
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]).toEqual(["we0", { supersetGroup: 1 }]);
    expect(result.current.busy).toBe(true);
    gates[0]!.resolve({});
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1]).toEqual(["we1", { supersetGroup: 1 }]);
    gates[1]!.resolve({});
    await act(async () => expect(await outcome).toEqual({ status: "done" }));
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: WORKOUT_KEYS.active });
    expect(result.current.busy).toBe(false);
  });

  it("a second run while one is in flight is a no-op", async () => {
    const gate = deferred<unknown>();
    const update = vi.fn(() => gate.promise) as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result } = setup(update);
    let first!: ReturnType<typeof result.current.run>;
    act(() => {
      first = result.current.run(slots(null, null), { type: "toggleLink", index: 0 });
    });
    await act(async () => expect(await result.current.run(slots(null, null), { type: "toggleLink", index: 0 })).toEqual({ status: "busy" }));
    expect(update).toHaveBeenCalledTimes(1);
    gate.resolve({});
    await act(async () => void (await first));
  });

  it("an empty plan sends nothing and refetches nothing", async () => {
    const update = vi.fn() as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result, invalidate } = setup(update);
    await act(async () => expect(await result.current.run(slots(null), { type: "toggleLink", index: 0 })).toEqual({ status: "done" }));
    expect(update).not.toHaveBeenCalled();
    expect(invalidate).not.toHaveBeenCalled();
  });

  it("a move tracks exercise_moved once, however many PATCHes it takes; a toggle tracks nothing", async () => {
    const update = vi.fn(async () => ({})) as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result } = setup(update);
    await act(async () => void (await result.current.run(slots(6, 6, null), { type: "move", id: "we1", direction: "down" })));
    expect(update).toHaveBeenCalledTimes(3);
    expect(tracked.track.mock.calls).toEqual([["exercise_moved", { direction: "down" }]]);
    await act(async () => void (await result.current.run(slots(null, null), { type: "toggleLink", index: 0 })));
    expect(tracked.track).toHaveBeenCalledTimes(1);
  });
});

describe("10.1 AC13 — the first failure stops the plan", () => {
  it("stops after the failed PATCH, refetches once, reports a multi-patch failure", async () => {
    let n = 0;
    const update = vi.fn(async () => {
      n += 1;
      if (n === 2) throw boom();
      return {};
    }) as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result, invalidate } = setup(update);
    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.run(slots(1, 1, 1, 1, 1, 1, 1, 1), { type: "toggleLink", index: 3 });
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledTimes(1);
    expect(outcome).toMatchObject({ status: "failed", retry: null });
    expect(tracked.track).not.toHaveBeenCalled();
  });
  it("a one-position-PATCH move failure carries that patch to re-send (06.1's Try again applies, R1)", async () => {
    const update = vi.fn(async () => {
      throw boom();
    }) as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result } = setup(update);
    await act(async () =>
      expect(await result.current.run(slots(null, null), { type: "move", id: "we1", direction: "up" })).toMatchObject({ status: "failed", retry: { id: "we1", position: 0 } }),
    );
  });
});

describe("10.1 AC15 — refusals are surfaced, not sent", () => {
  it("cap and no-free-group return their message and send nothing", async () => {
    const update = vi.fn() as unknown as WorkoutClient["updateWorkoutExercise"];
    const { result } = setup(update);
    await act(async () =>
      expect(await result.current.run(slots(1, 1, 1, 1, 2, 2, 2, 2, 2), { type: "toggleLink", index: 3 })).toEqual({ status: "refused", message: LINK_CAP_MESSAGE }),
    );
    const strays = Array.from({ length: 99 }, (_, i) => ({ id: `x${i}`, group: i + 1 }));
    await act(async () =>
      expect(await result.current.run(strays, { type: "toggleLink", index: 0 })).toEqual({ status: "refused", message: NO_FREE_GROUP_MESSAGE }),
    );
    expect(NO_FREE_GROUP_MESSAGE).toBe("This workout has too many supersets");
    expect(update).not.toHaveBeenCalled();
  });
});
