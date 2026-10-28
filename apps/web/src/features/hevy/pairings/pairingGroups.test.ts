import type { HevyPair } from "@sin/core";
import { describe, expect, it } from "vitest";

import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { groupPairings } from "./pairingGroups";

const pair = (id: string, role: HevyPair["role"], exId: string | null = null, active: boolean | null = exId === null ? null : true): HevyPair => ({
  hevyTemplateId: id,
  hevyTitle: `Hevy ${id}`,
  hevyType: "weight_reps",
  role,
  exerciseId: exId,
  exerciseActive: active,
  measureRule: null,
  exportAs: role === "exercise",
});

describe("20.0 AC24 — the list", () => {
  it("groups exercises A–Z, deleted ones apart, skips and markers apart", () => {
    const row = makeExercise({ id: exerciseId(1), name: "Row" });
    const bench = makeExercise({ id: exerciseId(2), name: "bench press" });
    const gone = makeExercise({ id: exerciseId(3), name: "Old Curl", isActive: false });
    const groups = groupPairings(
      {
        pairs: [
          pair("R", "exercise", row.id),
          pair("B1", "exercise", bench.id),
          pair("B2", "exercise", bench.id),
          pair("G", "exercise", gone.id, false),
          pair("U", "exercise", exerciseId(9)),
          pair("S", "skip"),
          pair("W", "warmup_placeholder"),
        ],
        sectionRules: [],
      },
      [row, bench, gone],
    );
    expect(groups.exercises.map((g) => [g.exercise.name, g.pairs.map((p) => p.hevyTemplateId)])).toEqual([
      ["bench press", ["B1", "B2"]],
      ["Row", ["R"]],
    ]);
    expect(groups.deleted.map((d) => [d.name, d.pairs.map((p) => p.hevyTemplateId)])).toEqual([
      ["Old Curl", ["G"]],
      [null, ["U"]],
    ]);
    expect(groups.skipped.map((p) => p.hevyTemplateId)).toEqual(["S"]);
    expect(groups.placeholders.map((p) => p.hevyTemplateId)).toEqual(["W"]);
  });
});
