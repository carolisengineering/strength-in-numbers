import { cleanup, screen, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { markupOf } from "../../test/markup";
import { makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  ...extra,
});

async function setup(opts: WorkoutDetailOptions) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const cards = () => screen.getAllByRole("article")[0]!.parentElement!.parentElement!; // article → slot → the cards container

describe("10.3 AC32 — no sections, no change", () => {
  it("a manual workout and a routine workout without sections render the 10.2 cards exactly (baseline recorded before Spec 10.3's edits)", async () => {
    await setup({
      exercises: [
        ex("A", null, { supersetGroup: 1, notes: "Pause", targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, sets: [makeSet({ setNumber: 1 })] }),
        ex("B", null, { supersetGroup: 1 }),
        ex("C"),
      ],
    });
    expect(within(document.body).queryAllByRole("region").filter((r) => r.getAttribute("aria-labelledby") !== null && !r.querySelector("h1"))).toEqual([]);
    expect(markupOf(cards())).toMatchSnapshot("manual");
    cleanup();
    await setup({ routineName: "Push B", exercises: [ex("A"), ex("B", null, { supersetGroup: 2 }), ex("C", null, { supersetGroup: 2 })] });
    expect(markupOf(cards())).toMatchSnapshot("routine, no sections");
  });
});
