import { focusManager } from "@tanstack/react-query";
import { screen, waitFor } from "@testing-library/react";
import { http } from "msw";
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

import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

const ACTIVE_URL = `${API_BASE_URL}/v1/workouts/active`;
const activeReads = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "GET" && r.path === "/v1/workouts/active").length;

afterEach(() => {
  focusManager.setFocused(undefined);
  cleanupApp();
});

describe("AC15 — /app/workouts states", () => {
  it("shows a spinner while the active query is pending", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const gate = deferred<void>();
    server.use(
      http.get(ACTIVE_URL, async () => {
        await gate.promise;
        return problemResponse(404, "not-found");
      }),
    );

    renderApp("/app/workouts");

    expect(await screen.findByText("Loading your workout…")).toBeInTheDocument();
    gate.resolve();
    expect(await screen.findByRole("button", { name: "Start workout" })).toBeInTheDocument();
  });

  it("404 from /active is not an error: it shows the Start screen", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });

    renderApp("/app/workouts");

    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start workout" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("200 shows the session", async () => {
    const fake = createWorkoutFake({ active: makeWorkoutDetail() });
    prepareApp({ auth, fake });

    renderApp("/app/workouts");

    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start workout" })).not.toBeInTheDocument();
  });

  it("any other failure shows an in-shell notice with the request id and a Try again that refetches", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    fake.failNext({ method: "GET", path: /\/v1\/workouts\/active$/ }, () => problemResponse(500, "about:blank"));

    const { user } = renderApp("/app/workouts");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't load your workout/);
    expect(alert).toHaveTextContent(/Request ID: /);
    expect(screen.getByTestId("app-shell")).toContainElement(alert); // in-shell, not a full-page gate

    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByRole("button", { name: "Start workout" })).toBeInTheDocument();
    expect(activeReads(fake)).toBe(2);
  });

  it("refetches on window focus (a phone returning from another app)", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    await screen.findByRole("button", { name: "Start workout" });
    expect(activeReads(fake)).toBe(1);

    // TanStack Query v5 learns about focus from `visibilitychange`; drive its focus manager directly.
    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(activeReads(fake)).toBe(2));
  });

  it("refetches on remount, and shows a workout that appeared while the lifter was away", async () => {
    const fake = createWorkoutFake();
    prepareApp({ auth, fake });
    const { router } = renderApp("/app/workouts");
    await screen.findByRole("button", { name: "Start workout" });

    await router.navigate("/app/profile");
    await screen.findByRole("heading", { name: "Profile" });
    fake.state.active = makeWorkoutDetail(); // started on another device meanwhile
    await router.navigate("/app/workouts");

    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(activeReads(fake)).toBe(2);
  });
});
