import { screen, within } from "@testing-library/react";
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

import { markupOf } from "../../test/markup";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const FINISHED = "2026-10-02T11:00:00.000Z";
const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, ...extra });
/** The exercises container: heading → its <section> → the slot div → the container. */
const exercisesBlock = () => screen.getByRole("heading", { level: 2, name: "A" }).closest("section")!.parentElement!.parentElement!;

describe("10.3 AC32 — no sections, no change (finished screen)", () => {
  it.each([["/app/workouts/"], ["/app/history/"]])("%s<id>: the exercise blocks render exactly as in 10.2 (baseline)", async (prefix) => {
    const detail = makeWorkoutDetail({
      id: "70000000-0000-4000-8000-000000000001",
      endedAt: FINISHED,
      routineName: "Push B",
      exercises: [ex("A", null, { supersetGroup: 1, notes: "Pause", sets: [makeSet({ setNumber: 1 })] }), ex("B", null, { supersetGroup: 1 }), ex("C")],
    });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [detail] }) });
    renderApp(`${prefix}${detail.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(markupOf(exercisesBlock())).toMatchSnapshot();
  });
});
void within;
