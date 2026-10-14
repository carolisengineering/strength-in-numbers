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

import { markupOf } from "../../test/markup";
import { catalog, pushA, pushSectioned } from "../../test/routineFixtures";
import { routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

describe("10.3 AC20 — a section-free routine previews exactly as in 10.2", () => {
  it("the exercise list markup is unchanged (baseline recorded before Spec 10.3's edits)", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(markupOf(screen.getByRole("list", { name: "Exercises" }))).toMatchSnapshot();
  });
});
