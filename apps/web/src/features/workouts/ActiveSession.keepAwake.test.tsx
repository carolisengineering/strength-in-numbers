import { screen } from "@testing-library/react";
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

import { KEEP_AWAKE_KEY } from "../../ui/keepAwake";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const release = vi.fn(async () => {});
const request = vi.fn(async () => ({ released: false, release }));

beforeEach(() => {
  release.mockClear();
  request.mockClear();
  Object.defineProperty(navigator, "wakeLock", { value: { request }, configurable: true });
});
afterEach(() => {
  cleanupApp();
  window.localStorage.removeItem(KEEP_AWAKE_KEY);
  delete (navigator as { wakeLock?: unknown }).wakeLock;
});

const active = () => makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "X", sets: [makeSet({ setNumber: 1 })] }] });

describe("#108 — the workout screen keeps the screen on", () => {
  it("holds a screen wake lock while a workout is open, and lets go on leaving it", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: active() }) });
    const { user } = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(request).toHaveBeenCalledWith("screen");

    await user.click(screen.getByRole("link", { name: "History" }));
    await screen.findByRole("heading", { name: "History" });
    expect(release).toHaveBeenCalled();
  });

  it("asks for nothing when the setting is off", async () => {
    window.localStorage.setItem(KEEP_AWAKE_KEY, "off");
    prepareApp({ auth, fake: createWorkoutFake({ active: active() }) });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(request).not.toHaveBeenCalled();
  });

  it("asks for nothing on the Start screen, with no workout running", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: null }) });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Start a workout" });
    expect(request).not.toHaveBeenCalled();
  });

  it("Profile carries the switch", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: null }) });
    renderApp("/app/profile");
    expect(await screen.findByRole("checkbox", { name: "Keep screen on during workouts" })).toBeChecked();
  });
});
