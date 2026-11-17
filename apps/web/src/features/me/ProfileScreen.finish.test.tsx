import { screen, within } from "@testing-library/react";
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
vi.mock("../../observability/track", () => ({ track: vi.fn() }));

import { localStorageAdapter } from "../../storage/storage";
import { USER_ID } from "../../test/catalogHarness";
import { createWorkoutFake } from "../../test/workoutFake";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { outboxKey } from "../workouts/outbox/outbox";

let online: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
});
afterEach(() => {
  online.mockRestore();
  cleanupApp();
});

describe("06.7 AC31 — the logout-guard dialog counts and words a waiting workout", () => {
  it("Profile's Sign out with a finish waiting opens the 06.5 warning, worded for a workout; Stay keeps it", async () => {
    const w = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet()] }] });
    prepareApp({ auth, fake: createWorkoutFake({ active: w }) });
    localStorageAdapter().set(
      outboxKey(USER_ID),
      JSON.stringify({
        v: 1,
        userId: USER_ID,
        idMap: {},
        ops: [
          {
            id: "finish-op",
            kind: "finish",
            workoutId: w.id,
            userId: USER_ID,
            status: "queued",
            attempted: false,
            attempts: 0,
            nextAttemptAt: 0,
            enqueuedAt: 0,
            body: { endedAt: "2026-10-02T11:00:00.000Z" },
            meta: { startedAt: w.startedAt, exerciseCount: 1, setCount: 1, endedEarly: false, unloggedPlannedSets: 0, hadPlannedDuration: false },
          },
        ],
      }),
    );
    const { user } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Sign out" }, { timeout: 4000 }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("1 finished workout hasn't sent. If you sign out now it'll be lost.")).toBeInTheDocument();
    expect(auth.state.logout).not.toHaveBeenCalled();
    await user.click(dialog.getByRole("button", { name: "Stay" }));
    expect(auth.state.logout).not.toHaveBeenCalled();
    expect(localStorageAdapter().get(outboxKey(USER_ID))).not.toBeNull();
  });
});
