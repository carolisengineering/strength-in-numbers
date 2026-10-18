// apps/api/test/unit/finished-set-rules.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { MODALITY_VALUES, requiredMeasuresFor } from "@sin/core";
import { ValidationError, WorkoutWouldBeEmptyError } from "../../src/errors/app-error.js";
import { assertWouldNotEmpty } from "../../src/repositories/set-entry.prisma.js";
import { assertFinishedSetComplete } from "../../src/repositories/set-writes.js";

const empty = { reps: null, weight: null, distance: null, durationS: null };

describe("07.4 AC9 — assertFinishedSetComplete", () => {
  it("a weight_reps working set missing reps names `reps`, with a static message", () => {
    try {
      assertFinishedSetComplete("weight_reps", "working", { ...empty, weight: 100 });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).fieldErrors).toEqual([{ path: "reps", message: "required on a finished workout" }]);
    }
  });

  it.each(MODALITY_VALUES)("%s: an empty working set names exactly its required measures", (modality) => {
    try {
      assertFinishedSetComplete(modality, "working", empty);
      expect.unreachable();
    } catch (e) {
      expect((e as ValidationError).fieldErrors?.map((f) => f.path)).toEqual([...requiredMeasuresFor(modality)]);
    }
  });

  it.each(["warmup", "drop", "failure"] as const)("a half-filled %s set is exempt", (setType) => {
    expect(() => assertFinishedSetComplete("weight_reps", setType, { ...empty, reps: 5 })).not.toThrow();
  });

  it("a complete working set passes", () => {
    expect(() => assertFinishedSetComplete("weight_reps", "working", { ...empty, reps: 5, weight: 100 })).not.toThrow();
  });
});

class CountingPrisma {
  calls: string[] = [];
  constructor(private readonly count: number) {}
  $queryRaw = (strings: TemplateStringsArray): Promise<unknown[]> => {
    this.calls.push(strings.join("?"));
    return Promise.resolve([{ n: this.count }]);
  };
  $executeRaw = (): Promise<number> => Promise.resolve(1);
}

describe("07.4 AC10 — assertWouldNotEmpty", () => {
  it.each([
    [1, 1, true],
    [3, 3, true],
    [2, 1, false],
    [0, 0, false], // a legacy finished workout that already has no sets is not made worse
    [5, 0, false],
  ])("%i sets, removing %i → refuses: %s", async (n, removed, refuses) => {
    const stub = new CountingPrisma(n);
    const run = assertWouldNotEmpty(stub as unknown as PrismaClient, "w-1", removed);
    if (refuses) await expect(run).rejects.toBeInstanceOf(WorkoutWouldBeEmptyError);
    else await expect(run).resolves.toBeUndefined();
    expect(stub.calls).toHaveLength(1);
  });

  it("the refusal carries the workout id for the log line", async () => {
    await expect(assertWouldNotEmpty(new CountingPrisma(1) as unknown as PrismaClient, "w-9", 1)).rejects.toMatchObject({ workoutId: "w-9" });
  });
});
