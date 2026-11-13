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

import { createWorkoutFake, problemResponse } from "../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../test/workoutHarness";

afterEach(() => cleanupApp());

const h1 = (name: string) => screen.findByRole("heading", { level: 1, name });

// The app header already says these words, so the page's own h1 is hidden from sight (still in the tree).
describe("17.13 AC10 — no title said twice", () => {
  it.each([
    ["History", "/app/history"],
    ["Exercises", "/app/exercises"],
    ["Profile", "/app/profile"],
  ])("%s's h1 is hidden from sight", async (title, path) => {
    prepareApp({ auth, fake: createWorkoutFake() });
    renderApp(path);
    expect((await h1(title)).className).toMatch(/titleHidden/);
  });

  it("review focus 3: Workouts' error branch, titled Workouts, hides its h1 too", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    fake.failNext({ method: "GET", path: /\/v1\/workouts\/active$/ }, () => problemResponse(500, "about:blank"));
    renderApp("/app/workouts");
    expect((await h1("Workouts")).className).toMatch(/titleHidden/);
  });

  it("Workouts' Start view keeps its visible 'Start a workout' (Carol, 2026-11-08): it doesn't repeat the header", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    renderApp("/app/workouts");
    expect((await h1("Start a workout")).className).not.toMatch(/titleHidden/);
  });
});
