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
});
