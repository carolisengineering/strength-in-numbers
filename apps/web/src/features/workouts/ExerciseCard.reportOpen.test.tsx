import { screen, waitFor, within } from "@testing-library/react";
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

// Minor 781: a pass-through spy, so the card's real report runs and the test sees what the card handed it.
const report = vi.hoisted(() => ({ spy: vi.fn() }));
vi.mock("./useReportOpen", async (importActual) => {
  const actual = await importActual<typeof import("./useReportOpen")>();
  return {
    useReportOpen: (open: boolean, onChange?: (open: boolean) => void) => {
      report.spy(open, onChange);
      actual.useReportOpen(open, onChange);
    },
  };
});

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { card } from "../../test/sessionHelpers";
import { sheetRow } from "../../test/sheetHelpers";

afterEach(() => {
  report.spy.mockReset();
  cleanupApp();
});

describe("minor 781 — the card reports its sheet through useReportOpen", () => {
  it("minor 781: the card reports its set sheet through useReportOpen", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 5 })] }] }),
    });
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(report.spy.mock.calls.some(([open]) => open === true)).toBe(false);
    await user.click(within(card("Bench press")).getByRole("button", { name: /60 kg × 5/ }));
    await screen.findByRole("dialog", { name: /^Set 1/ });
    expect(report.spy.mock.calls.some(([open]) => open === true)).toBe(true);
    await user.click(sheetRow().getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: /^Set 1/ })).toBeNull());
    expect(report.spy.mock.calls.at(-1)![0]).toBe(false);
  });
});
