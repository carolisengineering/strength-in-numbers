import { act, cleanup, screen } from "@testing-library/react";
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

import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_EDIT_PATH, IMPORT_NAMES_PATH, IMPORT_PATH } from "../paths";
import { PASTE_TITLE, READ_BUTTON, TEXT_LABEL } from "./messages";

afterEach(() => cleanupApp());

describe("10.4 AC20 — routes and the in-memory session", () => {
  it("the three import paths rank above workouts/routines/:id", async () => {
    for (const path of [IMPORT_PATH, IMPORT_NAMES_PATH, IMPORT_EDIT_PATH]) {
      const fake = createWorkoutFake();
      prepareApp({ auth, fake });
      const { router } = renderApp(path);
      expect(await screen.findByRole("heading", { level: 1, name: PASTE_TITLE })).toBeInTheDocument();
      expect(router.state.location.pathname).toBe(IMPORT_PATH); // names/edit with an empty session redirect
      expect(fake.requests.some((r) => r.path.startsWith("/v1/routines/import"))).toBe(false);
      cleanup();
      cleanupApp();
    }
  });

  it("the session survives moving between import screens and is gone after leaving them", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    const { router, user } = renderApp(IMPORT_PATH);
    await user.click(await screen.findByLabelText(TEXT_LABEL));
    await user.paste("Strength\n3 Sets:\n10 Curl\nx.");
    await user.click(screen.getByRole("button", { name: READ_BUTTON }));
    await act(() => router.navigate(IMPORT_PATH));
    expect(await screen.findByLabelText(TEXT_LABEL)).toHaveValue("Strength\n3 Sets:\n10 Curl\nx.");
    await act(() => router.navigate("/app/history"));
    await act(() => router.navigate(IMPORT_PATH));
    expect(await screen.findByLabelText(TEXT_LABEL)).toHaveValue("");
  });
});
