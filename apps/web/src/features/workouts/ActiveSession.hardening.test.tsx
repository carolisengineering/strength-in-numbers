import { screen, waitFor, within } from "@testing-library/react";
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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const scrolled: Element[] = [];
const scrollIntoView = vi.fn(function (this: Element) {
  scrolled.push(this);
});

beforeEach(() => {
  Element.prototype.scrollIntoView = scrollIntoView;
});
afterEach(() => {
  observability.track.mockReset();
  scrollIntoView.mockClear();
  scrolled.length = 0;
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const finishButton = () => screen.getByRole("button", { name: "Finish" });
const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const incompleteSet = (setNumber: number) =>
  makeSet({ setNumber, weight: null, weightUnit: null, reps: 8, isComplete: false });

describe("06.4 AC3 — scroll-into-view uses a ref, on the first flagged row only", () => {
  it("scrolls once, to the first flagged row in display order, when two cards each hold one", async () => {
    const { user } = await setup([
      { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 }), incompleteSet(2)] },
      { modality: "weight_reps", name: "Y", sets: [incompleteSet(1)] },
    ]);

    await user.click(finishButton());
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("alert");

    expect(screen.getAllByText("Needs data")).toHaveLength(2);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    const target = scrolled[0]!;
    expect(within(screen.getByRole("article", { name: "X" })).getByText("Needs data").closest("button")).toBe(target);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
  });
});
