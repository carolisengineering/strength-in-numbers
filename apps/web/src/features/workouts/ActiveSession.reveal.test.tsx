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

import { card, finishButton, logButton, makeCurrent } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const scroll = vi.fn();
beforeEach(() => {
  scroll.mockReset();
  Element.prototype.scrollIntoView = scroll;
});
afterEach(() => cleanupApp());

const T_EARLY = "2026-10-02T10:00:00.000Z";
const T_LATE = "2026-10-02T10:10:00.000Z";

describe("17.1 AC17 — reveal before scrolling", () => {
  it("'Show' on a failed set in a collapsed card makes it current, then scrolls to the row", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: [
          { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, createdAt: T_LATE })] },
          { modality: "weight_reps", name: "Y", sets: [makeSet({ setNumber: 1, createdAt: T_EARLY })] },
        ],
      }),
    });
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await makeCurrent(user, "Y");
    fake.failNext({ method: "POST", path: /\/sets$/ }, () => problemResponse(422, "validation-error"));
    await user.click(logButton("Y"));
    await within(card("Y")).findByText("Couldn't save");
    await makeCurrent(user, "X");
    expect(within(card("Y")).getByText("Couldn't save")).toBeInTheDocument(); // AC34: a collapsed row says it too
    scroll.mockClear();
    await user.click(within(screen.getByTestId("sync-status")).getByRole("button", { name: "Show" }));
    const failed = await within(card("Y")).findByText("Couldn't save", { selector: "span" });
    const row = failed.closest("li")!;
    await waitFor(() => expect(scroll.mock.contexts).toContain(row));
  });

  it("a Finish blocked by a working set missing data expands that set's exercise, then scrolls to it", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: [
          { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1, createdAt: T_LATE })] },
          { modality: "weight_reps", name: "Y", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, weightKg: null, isComplete: false, createdAt: T_EARLY })] },
        ],
      }),
    });
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(within(card("Y")).queryByRole("form")).toBeNull();
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(409, "incomplete-working-sets"));
    await user.click(finishButton());
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
    const flagged = await within(card("Y")).findByText("Needs data");
    await waitFor(() => expect(scroll.mock.contexts).toContain(flagged.closest("button")));
  });
});

describe("17.1 AC9 — the current-set panel is brought into view when the screen opens", () => {
  it("scrolls the current card's panel into view ('nearest', clear of the bar) once on load", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({
        exercises: [
          { modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] },
          { modality: "weight_reps", name: "Y" },
        ],
      }),
    });
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    const panel = within(card("X")).getByRole("form");
    await waitFor(() => expect(scroll.mock.contexts).toContain(panel));
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
  });
});
