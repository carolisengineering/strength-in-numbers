import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { resolveExercise } from "./resolveExercise";

const ME = "00000000-0000-4000-8000-0000000000aa";
const SYNCED = { synced: true, failed: false };
const COLD = { synced: false, failed: false };
const FAILED = { synced: false, failed: true };

describe("18.2 AC19 — resolveExercise", () => {
  const bench = makeExercise({ id: exerciseId(1), name: "Bench" });

  it("finds a visible row whether or not the store has synced", () => {
    expect(resolveExercise([bench], exerciseId(1), SYNCED)).toEqual({ kind: "found", row: bench });
    expect(resolveExercise([bench], exerciseId(1), COLD)).toEqual({ kind: "found", row: bench });
    expect(resolveExercise([bench], exerciseId(1), FAILED)).toEqual({ kind: "found", row: bench });
  });

  it("redirects a fork origin to its newest active fork, lower id on a tie", () => {
    const older = makeExercise({ id: exerciseId(5), ownerUserId: ME, forkedFromExerciseId: exerciseId(1), createdAt: "2026-02-01T00:00:00.000Z" });
    const newer = makeExercise({ id: exerciseId(6), ownerUserId: ME, forkedFromExerciseId: exerciseId(1), createdAt: "2026-03-01T00:00:00.000Z" });
    expect(resolveExercise([bench, older, newer], exerciseId(1), SYNCED)).toEqual({ kind: "redirect", to: exerciseId(6) });

    const tieA = makeExercise({ id: exerciseId(8), ownerUserId: ME, forkedFromExerciseId: exerciseId(1), createdAt: "2026-03-01T00:00:00.000Z" });
    const tieB = makeExercise({ id: exerciseId(7), ownerUserId: ME, forkedFromExerciseId: exerciseId(1), createdAt: "2026-03-01T00:00:00.000Z" });
    expect(resolveExercise([bench, tieA, tieB], exerciseId(1), COLD)).toEqual({ kind: "redirect", to: exerciseId(7) });
  });

  it("ignores an inactive fork when deciding a redirect", () => {
    const gone = makeExercise({ id: exerciseId(5), ownerUserId: ME, forkedFromExerciseId: exerciseId(1), isActive: false });
    expect(resolveExercise([bench, gone], exerciseId(1), SYNCED)).toEqual({ kind: "found", row: bench });
  });

  it("calls an unknown or inactive id deleted once synced", () => {
    expect(resolveExercise([bench], exerciseId(9), SYNCED)).toEqual({ kind: "deleted" });
    const inactive = makeExercise({ id: exerciseId(2), isActive: false });
    expect(resolveExercise([bench, inactive], exerciseId(2), SYNCED)).toEqual({ kind: "deleted" });
  });

  it("waits for the first sync, or reports its failure", () => {
    expect(resolveExercise([], exerciseId(9), COLD)).toEqual({ kind: "loading" });
    expect(resolveExercise([bench], exerciseId(9), FAILED)).toEqual({ kind: "error" });
  });
});
