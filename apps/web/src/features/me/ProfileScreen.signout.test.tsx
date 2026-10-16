import { screen, waitFor, within } from "@testing-library/react";
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
import { createWorkoutFake } from "../../test/workoutFake";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { DRAFTS_KEY } from "../workouts/drafts/draftStore";

let online: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  online = vi.spyOn(window.navigator, "onLine", "get").mockReturnValue(false);
});
afterEach(() => {
  online.mockRestore();
  cleanupApp();
});

async function openProfileWithQueuedSet() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", sets: [makeSet({ setNumber: 1, reps: 8, weight: 80 })] }] }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  await app.user.click(within(screen.getByRole("article", { name: "Bench" })).getByRole("button", { name: "Log set" }));
  await app.router.navigate("/app/profile");
  await screen.findByRole("button", { name: "Sign out" });
  return app;
}

describe("06.5 AC23 — the Profile button is Sign out and runs the guard", () => {
  it("has no 'Log out' text left on the screen", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: null }) });
    renderApp("/app/profile");
    await screen.findByRole("button", { name: "Sign out" });
    expect(screen.queryByText("Log out")).not.toBeInTheDocument();
  });

  it("nothing unsaved: signs out at once, no dialog", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: null }) });
    const { user } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(auth.state.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("unsaved sets: opens the dialog, does not log out until 'Sign out anyway'", async () => {
    const { user } = await openProfileWithQueuedSet();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/1 set hasn't saved/)).toBeInTheDocument();
    expect(auth.state.logout).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole("button", { name: "Sign out anyway" }));
    expect(auth.state.logout).toHaveBeenCalledTimes(1);
  });
});

describe("06.5 AC20 — the dialog is accessible", () => {
  it("Stay is the default focus; Stay closes the dialog and keeps the session", async () => {
    const { user } = await openProfileWithQueuedSet();
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("button", { name: "Stay" })).toHaveFocus();
    await user.click(within(dialog).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(auth.state.logout).not.toHaveBeenCalled();
  });
});

describe("06.5 AC21 — drafts are discarded silently", () => {
  it("an edited draft in storage and an empty outbox: immediate sign out, no dialog", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: null }) });
    localStorageAdapter().set(DRAFTS_KEY, JSON.stringify({ v: 1, userId: "u", workoutId: "w", byExercise: {} }));
    const { user } = renderApp("/app/profile");
    await user.click(await screen.findByRole("button", { name: "Sign out" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(auth.state.logout).toHaveBeenCalledTimes(1);
  });
});
