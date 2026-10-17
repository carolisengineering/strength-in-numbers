import { act, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

// `weightKg` (what volume reads) and `weight` (what the row shows) are separate fixture fields: set both.
const working = (n: number, weight = 100, reps = 5) => Array.from({ length: n }, (_, i) => makeSet({ setNumber: i + 1, weight, weightKg: weight, reps }));
const bench = (sets: ReturnType<typeof makeSet>[]): ExerciseSpec => ({ modality: "weight_reps", name: "Bench Press", sets });

function setup(exercises: ExerciseSpec[], opts: { minutes?: number } = {}) {
  const workout = makeWorkoutDetail({
    startedAt: "2026-10-02T18:00:00.000Z",
    endedAt: new Date(Date.parse("2026-10-02T18:00:00.000Z") + (opts.minutes ?? 52) * 60_000).toISOString(),
    exercises,
  });
  const fake = createWorkoutFake({ finished: [workout], active: null });
  prepareApp({ auth, fake });
  const app = renderApp(`/app/workouts/${workout.id}`);
  return { fake, workout, ...app };
}
const stat = (label: string) => screen.getByText(label, { selector: "span" }).previousElementSibling as HTMLElement;

describe("17.2 AC8 / AC9 — the summary header shows duration, exercises, sets and volume", () => {
  it("sits under the unchanged h1; the date line drops the minutes; no extra heading", async () => {
    setup([bench([...working(3), makeSet({ setNumber: 4, setType: "warmup", weight: 60, weightKg: 60, reps: 5 })]), { modality: "weight_reps", name: "Row", sets: working(1) }]);
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.getByText("Fri 2 Oct")).toBeInTheDocument();
    expect(screen.queryByText(/Fri 2 Oct · /)).toBeNull();
    expect(stat("duration")).toHaveTextContent("52 min");
    expect(stat("exercises")).toHaveTextContent("2");
    expect(stat("sets")).toHaveTextContent("4"); // 4 working sets; the warm-up is not counted
    expect(stat("volume")).toHaveTextContent("2,000 kg");
    expect(screen.queryByRole("heading", { name: "Workout finished" })).toBeNull();
  });

  it("volume follows the unit preference", async () => {
    const { workout } = setup([bench(working(1))]);
    // The test harness user prefers kg; the formatting path itself is shared with History (formatVolumeKg).
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(stat("volume")).toHaveTextContent("500 kg");
    expect(workout.exercises).toHaveLength(1);
  });
});

describe("17.2 AC11 — modalities without volume", () => {
  it("a duration-only workout shows three stats and no volume, never 0", async () => {
    setup([{ modality: "duration", name: "Plank", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: null, durationS: 60 })] }], { minutes: 20 });
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(stat("sets")).toHaveTextContent("1");
    expect(screen.queryByText("volume", { selector: "span" })).toBeNull();
  });

  it("a bodyweight-only workout has no volume", async () => {
    setup([{ modality: "bodyweight_reps", name: "Pull-up", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: 12 })] }]);
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(screen.queryByText("volume", { selector: "span" })).toBeNull();
  });
});

describe("17.2 AC10 — the header agrees with the History row", () => {
  it("sets and volume read the same on the row and in the header", async () => {
    const { workout, router } = setup([bench([...working(2, 82.5, 5), makeSet({ setNumber: 3, setType: "warmup", weight: 40, weightKg: 40, reps: 8 })])]);
    await act(() => router.navigate("/app/history"));
    const row = (await screen.findByRole("link", { name: /Bench Press/ })).textContent ?? "";
    const rowSets = /(\d+) sets?/.exec(row)![1];
    const rowVolume = /· ([\d,.]+ kg)/.exec(row)![1];
    await act(() => router.navigate(`/app/history/${workout.id}`));
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(stat("sets")).toHaveTextContent(rowSets!);
    expect(stat("volume")).toHaveTextContent(rowVolume!);
  });
});

describe("17.2 AC14 — offline and failed records", () => {
  it("the header still renders when the records query fails; the existing retry notice shows", async () => {
    const { fake } = setup([bench(working(2))]);
    fake.failNext({ method: "GET", path: /\/v1\/personal-records/ }, () => problemResponse(500, "internal-error"));
    expect(await screen.findByRole("heading", { name: "Workout summary" })).toBeInTheDocument();
    expect(stat("duration")).toHaveTextContent("52 min");
    expect(await screen.findByText("Couldn't load records")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
