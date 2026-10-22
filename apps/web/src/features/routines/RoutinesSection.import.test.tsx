import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { act, screen } from "@testing-library/react";
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
import { makeRoutine, routineId } from "../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { PASTE_TITLE } from "./import/messages";
import { LIMIT_MESSAGE } from "./messages";
import { EDITOR_FROM_BACK, IMPORT_PATH } from "./paths";

afterEach(() => cleanupApp());

describe("10.4 AC19 — entry and the 50-routine limit", () => {
  it("New from text sits beside New routine and opens the paste screen; Back returns to Workouts", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    const { user, router } = renderApp("/app/workouts");
    const link = await screen.findByRole("link", { name: "New from text" });
    expect(link).toHaveAttribute("href", IMPORT_PATH);
    expect(screen.getByRole("link", { name: "New routine" })).toBeInTheDocument();
    await user.click(link);
    expect(await screen.findByRole("heading", { level: 1, name: PASTE_TITLE })).toBeInTheDocument();
    expect(router.state.location.state).toEqual(EDITOR_FROM_BACK);
    await act(() => router.navigate(-1));
    expect(await screen.findByRole("heading", { level: 1, name: "Start a workout" })).toBeInTheDocument();
  });

  it("hidden while the list loads", async () => {
    const fake = createWorkoutFake();
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => new Promise<Response>(() => {}) as unknown as Response);
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    await screen.findByText("Loading routines…");
    expect(screen.queryByRole("link", { name: "New from text" })).toBeNull();
    expect(screen.queryByRole("button", { name: "New from text" })).toBeNull();
  });

  it("at the limit both are disabled and described by the one message", async () => {
    const routines = Array.from({ length: ROUTINES_PER_USER_MAX }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${i}` }));
    prepareApp({ auth, fake: createWorkoutFake({ routines }) });
    renderApp("/app/workouts");
    for (const name of ["New routine", "New from text"]) {
      const button = await screen.findByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button).toHaveAccessibleDescription(LIMIT_MESSAGE);
    }
    expect(screen.getAllByText(LIMIT_MESSAGE)).toHaveLength(1);
  });
});
