// apps/web/src/features/routines/routes.test.tsx  (AC14 — grows in Tasks 9 and 12)
import { screen } from "@testing-library/react";
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

import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

describe("10.0 AC14 — routes and navigation", () => {
  it("the bare /app/workouts/routines lands on the Start screen, never the finished-workout screen", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/workouts/routines");
    expect(await screen.findByRole("heading", { level: 1, name: "Start a workout" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    expect(fake.requests.some((r) => r.path === "/v1/workouts/routines")).toBe(false);
  });
  it("the preview route renders under the Workouts nav item", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ routines: [makeRoutine({ id: routineId(1) })] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(screen.getByRole("link", { name: "Workouts" })).toHaveAttribute("aria-current", "page");
    for (const name of ["History", "Progress", "Profile"]) {
      expect(screen.getByRole("link", { name })).not.toHaveAttribute("aria-current");
    }
  });

  it("/app/workouts/:id is unchanged", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    renderApp("/app/workouts/30000000-0000-4000-8000-000000000001");
    await screen.findByRole("heading", { level: 1, name: "Page not found" });
    expect(fake.requests.some((r) => r.path === "/v1/workouts/30000000-0000-4000-8000-000000000001")).toBe(true);
  });
});
