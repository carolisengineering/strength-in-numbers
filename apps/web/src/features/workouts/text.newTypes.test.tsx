import type { Modality, PlannedSet } from "@sin/core";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { makeSet, makeWorkoutDetail, makeWorkoutSummary, type ExerciseSpec } from "../../test/workoutFixtures";
import { HistoryRow } from "../history/HistoryRow";
import { FinishStats } from "./FinishStatsList";
import { finishStatsFor } from "./finishStats";
import { formatSet } from "./format";
import { findIncompleteWorkingSets } from "./incomplete";
import { logLabel } from "./logAction";
import { draftFromSet, unitDefaultsFor, type SetDraft } from "./setDraft";
import { collapsedSummary } from "./summaryLine";
import { supersetRows } from "./supersetRows";

const draft = (modality: Modality, o: Partial<SetDraft>): SetDraft => ({ ...draftFromSet(null, unitDefaultsFor("kg", modality), "k"), ...o });
const CAL = { reps: null, weight: null, weightUnit: null, weightKg: null };

describe("18.1 AC15 — the bar label", () => {
  it.each<[string, Modality, Partial<SetDraft>, "kg" | "lb", string]>([
    ["calories", "calories", { calories: "20" }, "kg", "Log 20 cal"],
    ["calories, grouped", "calories", { calories: "1200" }, "kg", "Log 1,200 cal"],
    ["carry, kg profile", "weight_distance", { weight: "24", distance: "40" }, "kg", "Log 24 · 40 m"],
    ["carry, lb profile, kg draft", "weight_distance", { weight: "24", distance: "40", weightUnit: "kg" }, "lb", "Log 24 kg · 40 m"],
    ["hold", "weight_duration", { weight: "20", minutes: "1", seconds: "30" }, "kg", "Log 20 · 1:30"],
    ["Review Focus 5 — a hold typed as seconds only", "weight_duration", { weight: "20", minutes: "", seconds: "30" }, "kg", "Log 20 · 0:30"],
    ["unparsable calories", "calories", { calories: "x" }, "kg", "Log set"],
    ["a carry without a distance", "weight_distance", { weight: "24" }, "kg", "Log set"],
  ])("%s", (_label, modality, values, pref, expected) => {
    expect(logLabel(modality, draft(modality, values), pref)).toBe(expected);
  });
});

describe("18.1 AC17 — set text", () => {
  it.each<[Modality, Record<string, unknown>, string]>([
    ["calories", { ...CAL, calories: 20 }, "20 cal"],
    ["calories", { ...CAL, calories: 1200 }, "1,200 cal"],
    ["weight_distance", { reps: null, weight: 24, distance: 40, distanceUnit: "m", distanceM: 40 }, "24 kg · 40 m"],
    ["weight_duration", { reps: null, weight: 20, durationS: 90 }, "20 kg · 1:30"],
    ["weight_distance", { reps: null, weight: null, weightUnit: null, weightKg: null, distance: 40, distanceUnit: "m", distanceM: 40, isComplete: false }, "– · 40 m"],
    ["calories", { ...CAL, calories: null, isComplete: false }, "–"],
  ])("%s → %s", (modality, overrides, text) => {
    expect(formatSet(makeSet(overrides), modality)).toBe(text);
  });
  it("a warm-up keeps the suffix", () => {
    expect(formatSet(makeSet({ ...CAL, calories: 20, setType: "warmup" }), "calories")).toBe("20 cal (Warm-up)");
  });
});

const planned = (weight: number | null, unit: "kg" | "lb" = "kg"): PlannedSet => ({ setType: "working", repsLow: null, repsHigh: null, weight, weightUnit: weight === null ? null : unit });
const summary = (spec: ExerciseSpec, pref: "kg" | "lb") => collapsedSummary(supersetRows(makeWorkoutDetail({ exercises: [spec] }).exercises)[0]!, pref);

describe("18.1 AC18 — collapsed rows", () => {
  it("a planned carry reads next 24 on a kg profile, next 24 kg on a lb profile", () => {
    const spec: ExerciseSpec = { modality: "weight_distance", name: "Carry", plannedSets: [planned(24), planned(24)] };
    expect(summary(spec, "kg").text).toBe("Carry · next 24");
    expect(summary(spec, "lb").text).toBe("Carry · next 24 kg");
    expect(summary({ modality: "weight_duration", name: "Hold", plannedSets: [planned(20)] }, "kg").text).toBe("Hold · next 20");
  });
  it("a planned weighted row without a weight, and a calories exercise, read set N", () => {
    expect(summary({ modality: "weight_distance", name: "Carry", plannedSets: [planned(null), planned(null)] }, "kg").text).toBe("Carry · next set 1");
    expect(summary({ modality: "calories", name: "Bike", plannedSets: [planned(null), planned(null)] }, "kg").text).toBe("Bike · next set 1");
  });
});

describe("18.1 AC19 — finish integrity", () => {
  it("a working calories set without calories is flagged; a complete one is not", () => {
    const workout = makeWorkoutDetail({
      exercises: [{ modality: "calories", name: "Bike", sets: [makeSet({ ...CAL, calories: null, isComplete: false }), makeSet({ ...CAL, calories: 20, setNumber: 2 })] }],
    });
    expect(findIncompleteWorkingSets(workout)).toEqual([workout.exercises[0]!.sets[0]!.id]);
  });
  it("a calories-only workout has no volume, in the Finish stats and the History row", () => {
    const workout = makeWorkoutDetail({ exercises: [{ modality: "calories", name: "Bike", sets: [makeSet({ ...CAL, calories: 20 })] }] });
    const stats = finishStatsFor(workout, "2026-10-02T11:00:00.000Z");
    expect(stats.volumeKg).toBeNull();
    render(<FinishStats stats={stats} unitPreference="kg" />);
    expect(screen.queryByText("volume")).toBeNull();
    render(
      <MemoryRouter>
        <HistoryRow workout={makeWorkoutSummary({ totalVolume: null })} unitPreference="kg" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("link").textContent).not.toMatch(/kg|lb/);
  });
  it("a mixed workout's volume is the legacy sets' only", () => {
    const workout = makeWorkoutDetail({
      exercises: [
        { modality: "weight_reps", name: "Bench", sets: [makeSet({ weight: 100, weightKg: 100, reps: 5 })] },
        { modality: "weight_distance", name: "Carry", sets: [makeSet({ reps: null, weight: 24, weightKg: 24, distance: 40, distanceUnit: "m", distanceM: 40 })] },
      ],
    });
    expect(finishStatsFor(workout, "2026-10-02T11:00:00.000Z").volumeKg).toBe(500);
  });
});

describe("18.1 AC40 — feet in text", () => {
  it("bar and set text keep ft", () => {
    expect(logLabel("weight_distance", draft("weight_distance", { weight: "24", distance: "40", distanceUnit: "ft" }), "kg")).toBe("Log 24 · 40 ft");
    expect(formatSet(makeSet({ reps: null, weight: 24, distance: 40, distanceUnit: "ft", distanceM: 12.192 }), "weight_distance")).toBe("24 kg · 40 ft");
    expect(formatSet(makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, distance: 40, distanceUnit: "ft", distanceM: 12.192, durationS: 90 }), "distance_duration")).toBe("40 ft · 1:30");
  });
});
