import type { PersonalRecord } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { groupByExercise, headlineText } from "../progress/exercises";
import { RecordCards } from "./RecordCardList";
import { buildRecordCards, recordsNewCount } from "./recordCards";

const ROOT = "10000000-0000-4000-8000-0000000000c1";
const carry = makeSet({ reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 });
const workout = makeWorkoutDetail({ exercises: [{ modality: "weight_distance", name: "Farmer Carry", sets: [carry] }] });
const rec = (o: Partial<Record<keyof PersonalRecord, unknown>>) =>
  makePersonalRecord({ exerciseId: ROOT, sourceExerciseId: ROOT, exerciseName: "Farmer Carry", previousValue: null, sourceSetId: carry.id, ...o });
const cards = (records: PersonalRecord[]) => buildRecordCards({ records, workout, pref: "kg" });

describe("18.1 AC29 — record cards", () => {
  it("the lead order ends heaviest, est. 1RM, most reps, calories, distance, duration", () => {
    const every = (["max_duration", "max_distance", "max_calories", "max_reps", "best_est_1rm", "heaviest_weight"] as const).map((recordType) =>
      rec({ recordType, unit: recordType === "max_reps" ? "reps" : recordType === "max_calories" ? "cal" : recordType === "max_distance" ? "m" : recordType === "max_duration" ? "s" : "kg", value: 10 }),
    );
    const [c] = cards(every);
    expect(c!.lead.label).toBe("Heaviest weight");
    expect(c!.chips.map((x) => x.label)).toEqual(["Est. 1RM", "Most reps", "Most calories", "Longest distance", "Longest hold"]);
  });
  it("a calories card leads Most calories", () => {
    expect(cards([rec({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120 })])[0]!.lead).toMatchObject({ label: "Most calories", valueText: "120 cal", first: true });
  });
  it("a carry with both leads Heaviest weight with a Longest distance chip; the set text is the lead set", () => {
    const [c] = cards([rec({ recordType: "heaviest_weight", unit: "kg", value: 24 }), rec({ recordType: "max_distance", unit: "m", value: 40 })]);
    expect(c!.lead.label).toBe("Heaviest weight");
    expect(c!.chips.map((x) => x.label)).toEqual(["Longest distance"]);
    expect(c!.setText).toBe("24 kg · 40 m");
  });
  it("Review Focus 5 — a carry with only a distance record leads Longest distance and has no chip", () => {
    const [c] = cards([rec({ recordType: "max_distance", unit: "m", value: 40 })]);
    expect(c!.lead).toMatchObject({ label: "Longest distance", valueText: "40 m" });
    expect(c!.chips).toEqual([]);
  });
  it("a hold works the same way with Longest hold", () => {
    expect(cards([rec({ exerciseName: "Hold", recordType: "max_duration", unit: "s", value: 90 })])[0]!.lead).toMatchObject({ label: "Longest hold", valueText: "1 min 30 s" });
    const [both] = cards([rec({ exerciseName: "Hold", recordType: "heaviest_weight", unit: "kg", value: 20 }), rec({ exerciseName: "Hold", recordType: "max_duration", unit: "s", value: 90 })]);
    expect(both!.chips.map((x) => x.label)).toEqual(["Longest hold"]);
  });
  it("recordsNewCount counts them; the card uses only the existing record classes", () => {
    const records = [rec({ recordType: "heaviest_weight", unit: "kg", value: 24 }), rec({ recordType: "max_distance", unit: "m", value: 40 })];
    expect(recordsNewCount(records)).toBe(2);
    const { container } = render(<RecordCards cards={cards(records)} />);
    expect(screen.getByText("Longest distance")).toBeInTheDocument();
    const classes = new Set([...container.querySelectorAll("[class]")].flatMap((el) => [...el.classList]));
    for (const c of classes) expect(c).toMatch(/^_?(cards|card|top|name|set|label|figure|value|gain|was|chips|chip)/);
  });
});

describe("18.1 AC30 — Progress list headline", () => {
  it("an exercise with only a calories record reads Most calories 120 cal · Tue 6 Oct", () => {
    const r = makePersonalRecord({ exerciseName: "Echo Bike", recordType: "max_calories", unit: "cal", value: 120, previousValue: null, achievedAt: "2026-10-06T10:00:00.000Z", localDate: "2026-10-06" });
    expect(headlineText(groupByExercise([r])[0]!, "kg")).toBe("Most calories 120 cal · Tue 6 Oct");
  });
});
