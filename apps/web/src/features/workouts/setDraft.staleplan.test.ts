import { MODALITY_VALUES, type Modality, type PlannedSet } from "@sin/core";
import { describe, expect, it } from "vitest";

import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { logLabel } from "./logAction";
import { visibleMeasures } from "./measures";
import { parseDraft, seedDraft, unitDefaultsFor, type SetDraft } from "./setDraft";
import { collapsedSummary } from "./summaryLine";
import { supersetRows } from "./supersetRows";

/** A routine row written before the exercise's type changed (Spec 03.4 D22): it carries every measure. */
const stale: PlannedSet = { setType: "working", repsLow: 8, repsHigh: 8, weight: 60, weightUnit: "kg" };

/** The seeded draft, with the measures the type does carry filled in so it parses. */
function seeded(modality: Modality): SetDraft {
  const draft = seedDraft({ plannedSets: [stale], sets: [], defaults: unitDefaultsFor("kg", modality), attemptKey: "k" });
  const visible = visibleMeasures(modality);
  return {
    ...draft,
    ...(visible.includes("distance") ? { distance: "100" } : {}),
    ...(visible.includes("durationS") ? { minutes: "1", seconds: "0" } : {}),
    ...(visible.includes("calories") ? { calories: "10" } : {}),
  };
}

describe("18.2 AC52 — stale plans show only measures the type carries", () => {
  it.each(MODALITY_VALUES)("%s", (modality) => {
    const visible = visibleMeasures(modality);
    const weightHidden = !visible.includes("weight");
    const repsHidden = !visible.includes("reps");
    const draft = seeded(modality);
    // The stale values are in the draft (D13: seedDraft overlays them regardless of type) ...
    expect(draft.weight).toBe("60");
    expect(draft.reps).toBe("8");

    // ... and nothing downstream lets a hidden one out.
    const parsed = parseDraft(modality, draft);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    if (weightHidden) expect(parsed.body.weight ?? undefined).toBeUndefined();
    if (repsHidden) expect(parsed.body.reps ?? undefined).toBeUndefined();

    const label = logLabel(modality, draft, "kg");
    if (weightHidden) expect(label).not.toContain("60");
    if (repsHidden) expect(label).not.toContain("× 8");

    const [row] = supersetRows(makeWorkoutDetail({ exercises: [{ modality, name: "Lift", plannedSets: [stale], sets: [] }] }).exercises);
    const next = collapsedSummary(row!, "kg").text;
    if (weightHidden) expect(next).not.toContain("60");
    if (repsHidden) expect(next).not.toMatch(/\b8\b/);
  });
});
