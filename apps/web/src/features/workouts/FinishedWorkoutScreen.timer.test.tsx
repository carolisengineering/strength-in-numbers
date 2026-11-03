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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const FINISHED = "2026-10-02T11:00:00.000Z";
const ex = (name: string, sectionIndex: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, sets: [makeSet({ setNumber: 1 })] });

describe("10.7 AC20 — the summary", () => {
  it("an AMRAP with a result and readings shows its score and the times line; no button", async () => {
    const d = makeWorkoutDetail({
      endedAt: FINISHED,
      sections: [
        {
          name: "Finisher",
          notes: "Go hard",
          timer: { format: "amrap", capSeconds: 720 },
          result: { rounds: 5, reps: 7, capped: false, finishSeconds: null },
          roundTimes: [
            { round: 1, seconds: 250 },
            { round: 2, seconds: 515 },
          ],
        },
      ],
      exercises: [ex("Burpee", 0)],
    });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [d] }) });
    renderApp(`/app/history/${d.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    const region = screen.getByRole("region", { name: "Finisher" });
    expect(within(region).getByText("AMRAP 12:00 · 5 rounds + 7 reps")).toBeInTheDocument();
    expect(within(region).getByText("Round ends 4:10 · 8:35")).toBeInTheDocument();
    expect(within(region).getByText("Go hard")).toBeInTheDocument();
    expect(within(region).queryByRole("button")).toBeNull();
  });

  it("a Set Timer with nothing recorded shows only the plan", async () => {
    const d = makeWorkoutDetail({ endedAt: FINISHED, sections: [{ name: "Main", timer: { format: "set_timer", roundSeconds: 300, rounds: 5 } }], exercises: [ex("Thruster", 0)] });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [d] }) });
    renderApp(`/app/history/${d.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    const region = screen.getByRole("region", { name: "Main" });
    expect(within(region).getByText("Set Timer 5 × 5:00")).toBeInTheDocument();
    expect(within(region).queryByText(/^Rounds /)).toBeNull();
    expect(within(region).queryByText(/Only the first/)).toBeNull();
  });
});
