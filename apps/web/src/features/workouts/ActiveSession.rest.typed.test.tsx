import type { PlannedSet } from "@sin/core";
import { screen } from "@testing-library/react";
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

// The lifter typed between the tap and the response, so EntryRow reports `advance: false`. Through the app the outbox
// resolves a log at once and there is no window to type in, so the panel is stubbed to report that event directly.
vi.mock("./EntryRow", () => ({
  EntryRow: (props: { exercise: { id: string; exerciseNameSnapshot: string }; onLogged: (event: unknown) => void }) => (
    <button
      type="button"
      onClick={() => props.onLogged({ exerciseId: props.exercise.id, set: makeSet({ setType: "working", workoutExerciseId: props.exercise.id }), advance: false, wasExtra: false })}
    >
      {`stub ${props.exercise.exerciseNameSnapshot}`}
    </button>
  ),
}));

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const planned: PlannedSet[] = Array.from({ length: 3 }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string): ExerciseSpec => ({ modality: "weight_reps", name, restSeconds: 120, plannedSets: planned });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

describe("17.1 AC41 — a typed-since-tap log still rests", () => {
  it("starts the rest and does not advance current", async () => {
    const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [ex("A"), ex("B")] }), catalog: [bench] });
    prepareApp({ auth, fake, catalog: [bench] });
    const { user } = renderApp("/app/workouts");
    await user.click(await screen.findByRole("button", { name: "stub A" }));
    expect(screen.getByTestId("rest-line-fill")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "stub A" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stub B" })).toBeNull();
  });
});
