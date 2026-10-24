import { act, screen, waitFor } from "@testing-library/react";
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

import { cardGroups, importCatalog, readHiraya, toEditor } from "../../../test/importFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { IMPORT_NAMES_PATH, IMPORT_PATH, WORKOUTS_PATH } from "../paths";
import { BACK_TO_TEXT, PASTE_TITLE } from "./messages";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

/** Workouts, then the paste screen pushed on top of it, as the Workouts screen's link does. */
async function fromWorkouts() {
  const fake = createWorkoutFake({ catalog: [...importCatalog], serveExercises: true });
  prepareApp({ auth, fake, catalog: [...importCatalog] });
  const app = renderApp(WORKOUTS_PATH);
  await act(() => app.router.navigate(IMPORT_PATH));
  await screen.findByRole("heading", { level: 1, name: PASTE_TITLE });
  return app;
}

describe("deferred minor 27 — Back to text goes back instead of pushing", () => {
  it("paste → Check → Back to text → Read → browser Back lands on the paste screen, then Workouts", async () => {
    const { user, router } = await fromWorkouts();
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await user.click(screen.getByRole("link", { name: BACK_TO_TEXT }));
    await screen.findByRole("heading", { level: 1, name: PASTE_TITLE });
    await user.click(screen.getByRole("button", { name: "Read workout" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(IMPORT_NAMES_PATH));
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe(IMPORT_PATH);
    await act(() => router.navigate(-1));
    expect(router.state.location.pathname).toBe(WORKOUTS_PATH);
  });
});

describe("deferred minor 31 — after Save, one Back returns to Workouts", () => {
  it("the import's history entries give way to the saved routine's preview", async () => {
    const { user, router } = await fromWorkouts();
    await toEditor(user);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe(WORKOUTS_PATH));
  });

  it("still holds after browser Back then Forward on the Check screen (forward entries are kept)", async () => {
    const { user, router } = await fromWorkouts();
    await readHiraya(user);
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    await act(() => router.navigate(-1));
    await screen.findByRole("heading", { level: 1, name: PASTE_TITLE });
    await act(() => router.navigate(1));
    await waitFor(() => expect(cardGroups()).toHaveLength(8));
    const button = await screen.findByRole("button", { name: "Continue" });
    await waitFor(() => expect(button).toBeEnabled());
    await user.click(button);
    await screen.findByRole("heading", { level: 1, name: "New routine" });
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { level: 1, name: "Second Shift" });
    await act(() => router.navigate(-1));
    await waitFor(() => expect(router.state.location.pathname).toBe(WORKOUTS_PATH));
  });
});
