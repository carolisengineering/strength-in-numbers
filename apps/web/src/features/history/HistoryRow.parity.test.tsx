import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { act, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  state: {
    isLoading: false,
    isAuthenticated: true,
    error: undefined as Error | undefined,
    loginWithRedirect: vi.fn(),
    logout: vi.fn(),
    getAccessTokenSilently: vi.fn(),
  },
}));
vi.mock("@auth0/auth0-react", () => ({ useAuth0: () => auth.state }));

import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { API_BASE_URL } from "../../test/catalogHarness";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

function setup(recordTypes: ("heaviest_weight" | "best_est_1rm" | "best_set_volume")[]) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ reps: 5, weight: 100, weightKg: 100 })] }],
  });
  const e = workout.exercises[0]!;
  const records = recordTypes.map((recordType) =>
    makePersonalRecord({
      workoutId: workout.id,
      exerciseId: e.exerciseId,
      sourceExerciseId: e.exerciseId,
      sourceSetId: e.sets[0]!.id,
      recordType,
      unit: recordType === "best_set_volume" ? "kg_reps" : "kg",
      value: recordType === "best_set_volume" ? 500 : 100,
      previousValue: recordType === "best_set_volume" ? 450 : 90,
    }),
  );
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records }) });
  return { workout, ...renderApp("/app/history") };
}

/** A finished workout of `lifts` exercises, each holding a weight and an estimate record, beaten unless `firstOnly`. */
function setupLifts(lifts: number, { firstOnly = false } = {}) {
  const workout = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    exercises: Array.from({ length: lifts }, (_, i) => ({ modality: "weight_reps" as const, name: `Lift ${i + 1}`, sets: [makeSet({ reps: 5, weight: 100, weightKg: 100 })] })),
  });
  const records = workout.exercises.flatMap((e) =>
    (["heaviest_weight", "best_est_1rm"] as const).map((recordType) =>
      makePersonalRecord({
        workoutId: workout.id,
        exerciseId: e.exerciseId,
        sourceExerciseId: e.exerciseId,
        exerciseName: e.exerciseNameSnapshot,
        sourceSetId: e.sets[0]!.id,
        recordType,
        value: 100,
        previousValue: firstOnly ? null : 90,
      }),
    ),
  );
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records }) });
  return { workout, ...renderApp("/app/history") };
}

describe("07.6 AC15 — the badge names lifts", () => {
  it("three lifts that each beat two records: 'PR on 3 lifts', named 'Records on 3 lifts'", async () => {
    setupLifts(3);
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).getByRole("img", { name: "Records on 3 lifts" })).toHaveTextContent("PR on 3 lifts");
  });

  it("one lift: 'PR on 1 lift', named 'Records on 1 lift'", async () => {
    setupLifts(1);
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).getByRole("img", { name: "Records on 1 lift" })).toHaveTextContent("PR on 1 lift");
  });

  it("first-ever records only: no badge", async () => {
    setupLifts(2, { firstOnly: true });
    const row = await screen.findByRole("link", { name: /Lift 1/ });
    expect(within(row).queryByRole("img")).toBeNull();
  });
});

describe("07.6 AC17 — the fake counts lifts, as the API does", () => {
  it("six beaten non-volume rows over three lifts serve recordCount 3", async () => {
    setupLifts(3);
    const body = (await (await fetch(`${API_BASE_URL}/v1/workouts?limit=20`)).json()) as { items: { recordCount: number }[] };
    expect(body.items[0]!.recordCount).toBe(3);
  });
});

describe("17.2 AC34 / 07.6 AC16 — the History row and the summary agree", () => {
  it("weight, estimate and set volume beaten on one lift: the row says 'PR on 1 lift' and the summary counts 1 lift", async () => {
    const { workout, router } = setup(["heaviest_weight", "best_est_1rm", "best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).getByRole("img", { name: "Records on 1 lift" })).toHaveTextContent("PR on 1 lift");
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("region", { name: "Records from this workout on 1 lift" })).toBeInTheDocument();
  });

  it("a workout whose only record is set volume has no badge and no records section", async () => {
    const { workout, router } = setup(["best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).queryByRole("img")).toBeNull();
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /record/i })).toBeNull();
  });
});

describe("17.2 AC32 / 07.6 AC17 — the web never re-derives recordCount", () => {
  it("HistoryRow only compares recordCount to zero and prints it", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "HistoryRow.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // Spec 07.6: the one place it is printed is the copy helper, which only formats the number it is given.
    expect(code.match(/historyBadgeText\(workout\.recordCount\)/g)).toHaveLength(1);
    const rest = code.replace("historyBadgeText(workout.recordCount)", "");
    const uses = [...rest.matchAll(/recordCount[^\n]*/g)].map((m) => m[0]);
    expect(uses.length).toBeGreaterThan(0);
    expect(uses.every((u) => /^recordCount\s*>\s*0/.test(u))).toBe(true); // otherwise only compared to zero
    expect(src).not.toMatch(/recordCount\s*[-+*/]/);
  });
});
