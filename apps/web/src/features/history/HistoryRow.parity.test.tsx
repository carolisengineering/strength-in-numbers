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
      previousValue: null,
    }),
  );
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout], records }) });
  return { workout, ...renderApp("/app/history") };
}

describe("17.2 AC32 / AC34 — the History row and the summary agree (07.3)", () => {
  it("three records of which one is set volume: the row says 2 PRs and the summary says 2 new", async () => {
    const { workout, router } = setup(["heaviest_weight", "best_est_1rm", "best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).getByRole("img", { name: "2 personal records" })).toHaveTextContent("2 PRs");
    await act(() => router.navigate(`/app/history/${workout.id}`));
    const block = await screen.findByRole("region", { name: "Personal records" });
    expect(within(block).getByText("2 new")).toBeInTheDocument();
  });

  it("a workout whose only record is set volume has no badge and no records section", async () => {
    const { workout, router } = setup(["best_set_volume"]);
    const row = await screen.findByRole("link", { name: /Bench Press/ });
    expect(within(row).queryByRole("img")).toBeNull();
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Personal records" })).toBeNull();
  });
});

describe("17.2 AC32 — the web never re-derives recordCount", () => {
  it("HistoryRow only compares recordCount to zero and prints it", () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "HistoryRow.tsx"), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const uses = [...code.matchAll(/recordCount[^\n]*/g)].map((m) => m[0]);
    expect(uses.every((u) => /^recordCount\s*(>\s*0|,)/.test(u))).toBe(true); // compared to zero, or printed through plural()
    expect(src).not.toMatch(/recordCount\s*[-+*/]/);
  });
});
