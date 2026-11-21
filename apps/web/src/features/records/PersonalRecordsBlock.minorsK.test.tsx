import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { makeQueryClient } from "../../test/workoutHarness";
import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { PersonalRecordsBlock } from "./PersonalRecordsBlock";
import { RecordsClientContext } from "./queries";
import { EST_1RM_EXPLAINED } from "./recordLedger";

const lift = (name: string): ExerciseSpec => ({ modality: "weight_reps", name, sets: [makeSet({ reps: 5, weight: 190, weightKg: 190 })] });
const w = makeWorkoutDetail({ exercises: ["A", "B", "C", "D", "E", "F"].map(lift) });
const recOf = (i: number, o: Record<string, unknown>) => {
  const e = w.exercises[i]!;
  return makePersonalRecord({ exerciseId: e.exerciseId, sourceExerciseId: e.exerciseId, exerciseName: e.exerciseNameSnapshot, sourceSetId: e.sets[0]!.id, workoutId: w.id, ...o });
};
const heaviest = (i: number) => recOf(i, { recordType: "heaviest_weight", value: 190, previousValue: 185, unit: "kg" });
// Five rising lifts, only the 5th (E) with an estimate row; F's first-time line leads with an estimate.
const records = [heaviest(0), heaviest(1), heaviest(2), heaviest(3), recOf(4, { recordType: "best_est_1rm", value: 221.5, previousValue: 215, unit: "kg" }), recOf(5, { recordType: "best_est_1rm", value: 94, previousValue: null, unit: "kg" })];

describe("17.6 AC9 — minor 600: the estimate is explained exactly once, before and after Show all", () => {
  it("collapsed: once (under the first-time line); expanded: once (in the panel)", async () => {
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <RecordsClientContext.Provider value={{ listRecords: async () => records }}>
          <PersonalRecordsBlock workoutId={w.id} unitPreference="kg" workout={w} section="workouts" />
        </RecordsClientContext.Provider>
      </QueryClientProvider>,
    );
    const user = userEvent.setup();
    await waitFor(() => expect(screen.getAllByText(EST_1RM_EXPLAINED)).toHaveLength(1));
    await user.click(screen.getByRole("button", { name: /show all/i }));
    expect(screen.getAllByText(EST_1RM_EXPLAINED)).toHaveLength(1);
  });
});
