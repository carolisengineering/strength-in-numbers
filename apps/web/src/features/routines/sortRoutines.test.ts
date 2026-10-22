import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Routine } from "@sin/core";
import { resetConfigCache } from "../../config";
import { API_BASE_URL, stubWebEnv } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { createWorkoutFake } from "../../test/workoutFake";
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { sortRoutines } from "./useRoutineMutations";

const U = "2026-10-30T09:00:00.000Z";

/** A seeded Fisher–Yates over a small local PRNG, so every permutation case is reproducible. */
function shuffle<T>(list: readonly T[], seed: number): T[] {
  let state = seed + 1;
  const random = () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
  const out = [...list];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

const ids = (list: readonly Routine[]) => list.map((r) => r.id);

describe("10.5 AC1 — sortRoutines mirrors the served order", () => {
  // The order Spec 09.3 AC3 serves.
  const served = [
    makeRoutine({ id: routineId(5), name: "Class Fri 16 Oct", oneOffUntil: U, createdAt: "2026-10-16T08:00:00.000Z" }),
    makeRoutine({ id: routineId(3), name: "a tie", oneOffUntil: U, createdAt: "2026-10-15T08:00:00.000Z" }),
    makeRoutine({ id: routineId(4), name: "B tie", oneOffUntil: U, createdAt: "2026-10-15T08:00:00.000Z" }),
    makeRoutine({ id: routineId(1), name: "Pull Day", createdAt: "2026-10-20T08:00:00.000Z" }), // newer, but ordinary
    makeRoutine({ id: routineId(2), name: "push day" }),
  ];

  it.each(Array.from({ length: 20 }, (_, i) => i))("any input order → served order (permutation %i)", (seed) =>
    expect(ids(sortRoutines(shuffle(served, seed)))).toEqual(ids(served)));

  it("ordinary-only lists keep today's order", () => {
    const list = [
      makeRoutine({ id: routineId(9), name: "b" }),
      makeRoutine({ id: routineId(8), name: "a" }),
      makeRoutine({ id: routineId(7), name: "A" }),
    ];
    expect(ids(sortRoutines(list))).toEqual([routineId(7), routineId(8), routineId(9)]);
  });

  describe("the fake", () => {
    beforeEach(() => stubWebEnv());
    afterEach(() => {
      resetConfigCache();
      vi.unstubAllEnvs();
    });

    it("serves the same order", async () => {
      const fake = createWorkoutFake({ routines: shuffle(served, 3) });
      server.use(...fake.handlers);
      const body = (await (await fetch(`${API_BASE_URL}/v1/routines`)).json()) as { routines: Routine[] };
      expect(ids(body.routines)).toEqual(ids(served));
    });
  });
});
