import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, it, vi } from "vitest";

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

import { expectNoAxeViolations } from "../../../test/axe";
import { card, changeTimeButton } from "../../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail } from "../../../test/workoutFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { EDIT_COPY } from "./editCopy";

/**
 * Minor 9 (#161), Spec 18.0 AC44 / AC57: axe over the edit screen, its sheets, the last-set dialog and the finished
 * summary, in both themes. `color-contrast` is off in the helper (jsdom has no computed colors).
 */

const LONG_NOTE = `${"Shoulder felt tight on the third set, so the last two were paused reps. ".repeat(12)}End.`;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  delete document.documentElement.dataset.theme;
  cleanupApp();
});

/** A finished workout with two exercises (one in a section), sets, a title and a long note. */
function finishedWorkout() {
  return makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    title: "Heavy bench day",
    notes: LONG_NOTE,
    sections: [{ name: "Main", notes: "Work up to a heavy triple" }],
    exercises: [
      { modality: "weight_reps", name: "Bench Press", sectionIndex: 0, sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 }), makeSet({ setNumber: 2, weight: 70, reps: 5 })] },
      { modality: "weight_reps", name: "Row", sets: [makeSet({ setNumber: 1, weight: 50, reps: 10 })] },
    ],
  });
}

function open(path: (id: string) => string, workout = finishedWorkout()) {
  prepareApp({ auth, fake: createWorkoutFake({ finished: [workout] }) });
  return renderApp(path(workout.id));
}

async function openEdit() {
  const app = open((id) => `/app/history/${id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return app;
}

describe.each(["light", "dark"] as const)("Minor 9 — axe, %s theme", (theme) => {
  beforeEach(() => {
    document.documentElement.dataset.theme = theme;
  });

  it("the edit screen of a finished workout (Details panel, a section, sets)", async () => {
    await openEdit();
    await expectNoAxeViolations(document.body);
  });

  it("the Details sheet open", async () => {
    const { user } = await openEdit();
    await user.click(within(screen.getByRole("region", { name: "Details" })).getByRole("button", { name: "Edit details" }));
    await screen.findByRole("dialog", { name: "Details" });
    await expectNoAxeViolations(document.body);
  });

  it("the note sheet open", async () => {
    const { user } = await openEdit();
    await user.click(screen.getByRole("button", { name: "Add note for Bench Press" }));
    await screen.findByRole("dialog", { name: "Note for Bench Press" });
    await expectNoAxeViolations(document.body);
  });

  it("Change Time open", async () => {
    const { user } = await openEdit();
    await user.click(changeTimeButton());
    await screen.findByRole("dialog", { name: "Change Time" });
    await expectNoAxeViolations(document.body);
  });

  it("an edit-set form open", async () => {
    const { user } = await openEdit();
    await user.click(within(card("Bench Press")).getByRole("button", { name: /60 kg × 8/ }));
    await screen.findByRole("dialog", { name: /^Set 1/ });
    await expectNoAxeViolations(document.body);
  });

  it("the last-set dialog open", async () => {
    const one = makeWorkoutDetail({
      endedAt: "2026-10-02T11:00:00.000Z",
      exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }],
    });
    const { user } = open((id) => `/app/history/${id}/edit`, one);
    await screen.findByRole("heading", { level: 1, name: "Edit workout" });
    await user.click(within(card("Bench Press")).getByRole("button", { name: /60 kg × 8/ }));
    await user.click(within(screen.getByRole("dialog", { name: /^Set 1/ })).getByRole("button", { name: "Delete set" }));
    await waitFor(() => screen.getByRole("dialog", { name: EDIT_COPY.lastSet.title }));
    await expectNoAxeViolations(document.body);
  });

  it("the finished summary with a title and a long note", async () => {
    open((id) => `/app/workouts/${id}`);
    await screen.findByText("Heavy bench day");
    await expectNoAxeViolations(document.body);
  });
});
