import { describe, expect, it } from "vitest";
import { makePersonalRecord } from "../../test/workoutFixtures";
import { groupByExercise, headlineText } from "./exercises";

const BENCH = "10000000-0000-4000-8000-0000000000b1";
const PULL = "10000000-0000-4000-8000-0000000000b2";
const ODD = "10000000-0000-4000-8000-0000000000b3";

describe("08.1 AC6 — grouping records by exercise", () => {
  const records = [
    makePersonalRecord({ exerciseId: BENCH, exerciseName: "Bench (old name)", recordType: "heaviest_weight", value: 100, achievedAt: "2026-09-01T10:00:00.000Z", localDate: "2026-09-01" }),
    makePersonalRecord({ exerciseId: BENCH, exerciseName: "Barbell bench press", recordType: "best_est_1rm", value: 122.5, unit: "kg", achievedAt: "2026-10-06T10:00:00.000Z", localDate: "2026-10-06" }),
    makePersonalRecord({ exerciseId: PULL, exerciseName: "Pull-up", recordType: "max_reps", value: 15, unit: "reps", previousValue: null, achievedAt: "2026-10-04T10:00:00.000Z", localDate: "2026-10-04" }),
    makePersonalRecord({ exerciseId: ODD, exerciseName: "Odd lift", recordType: "best_set_volume", value: 900, unit: "kg_reps", achievedAt: "2026-08-01T10:00:00.000Z", localDate: "2026-08-01" }),
  ];

  it("one entry per lineage root, newest-record name, newest first", () => {
    expect(groupByExercise(records).map((e) => [e.exerciseId, e.name])).toEqual([
      [BENCH, "Barbell bench press"],
      [PULL, "Pull-up"],
      [ODD, "Odd lift"],
    ]);
  });

  it("headline precedence: e1RM, then heaviest, then max reps; volume never; none ⇒ null", () => {
    const [bench, pull, odd] = groupByExercise(records);
    expect(bench!.headline!.recordType).toBe("best_est_1rm");
    expect(pull!.headline!.recordType).toBe("max_reps");
    expect(odd!.headline).toBeNull();
    expect(groupByExercise([records[0]!])[0]!.headline!.recordType).toBe("heaviest_weight");
  });

  it("ties on achievedAt break by name, then id", () => {
    const at = "2026-10-01T10:00:00.000Z";
    const entries = groupByExercise([
      makePersonalRecord({ exerciseId: PULL, exerciseName: "Zercher", achievedAt: at }),
      makePersonalRecord({ exerciseId: BENCH, exerciseName: "Arnold press", achievedAt: at }),
    ]);
    expect(entries.map((e) => e.name)).toEqual(["Arnold press", "Zercher"]);
  });

  it("headline text in the lifter's unit, with the newest record's date", () => {
    const [bench, pull, odd] = groupByExercise(records);
    expect(headlineText(bench!, "kg")).toBe("Best est. 1RM 122.5 kg · Tue 6 Oct");
    expect(headlineText(bench!, "lb")).toBe("Best est. 1RM 270.1 lb · Tue 6 Oct");
    expect(headlineText(pull!, "kg")).toBe("Most reps 15 reps · Sun 4 Oct");
    expect(headlineText(odd!, "kg")).toBe("Sat 1 Aug");
  });
});
