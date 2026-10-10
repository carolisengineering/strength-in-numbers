import { screen, waitFor } from "@testing-library/react";
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

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));

import { http } from "msw";
import { API_BASE_URL } from "../../test/catalogHarness";
import { server } from "../../test/msw/server";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const startPosts = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/workouts");

async function setup(options: { active?: ReturnType<typeof makeWorkoutDetail> | null } = {}) {
  const fake = createWorkoutFake({ active: options.active ?? null });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  const start = await screen.findByRole("button", { name: "Start empty workout" });
  return { fake, start, ...app };
}

describe("AC16 — Start", () => {
  it("sends exactly { clientGeneratedId, startedAt, tzOffsetMinutes } and then shows the session", async () => {
    const { fake, start, user } = await setup();

    await user.click(start);

    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
    const posts = startPosts(fake);
    expect(posts).toHaveLength(1);
    const body = posts[0]!.body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["clientGeneratedId", "startedAt", "tzOffsetMinutes"]);
    expect(body["clientGeneratedId"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: false, fromRoutine: false });
  });

  it("a double tap creates one workout (a late second tap replays the same key)", async () => {
    const { fake, start, user } = await setup();

    await user.dblClick(start);

    await screen.findByRole("heading", { name: "Workout" });
    const keys = new Set(startPosts(fake).map((p) => (p.body as { clientGeneratedId: string }).clientGeneratedId));
    expect(keys.size).toBe(1);
    expect(screen.queryByText(/resumed it/)).toBeNull();
  });

  it("while the request is in flight the button is busy and disabled", async () => {
    const { start, user } = await setup();
    const gate = deferred<void>();
    server.use(
      http.post(`${API_BASE_URL}/v1/workouts`, async () => {
        await gate.promise;
        return problemResponse(500, "about:blank");
      }),
    );

    await user.click(start);

    expect(start).toBeDisabled();
    expect(start).toHaveAttribute("aria-busy", "true");
    gate.resolve();
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  });

  it("a network or 5xx failure shows an error, and the retry reuses the same clientGeneratedId", async () => {
    const { fake, start, user } = await setup();
    fake.failNext({ method: "POST", path: /\/v1\/workouts$/ }, () => problemResponse(500, "about:blank"));

    await user.click(start);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/Couldn't start your workout/);
    await user.click(screen.getByRole("button", { name: "Try again" }));

    await screen.findByRole("heading", { name: "Workout" });
    const [first, second] = startPosts(fake);
    expect((second!.body as Record<string, unknown>)["clientGeneratedId"]).toBe(
      (first!.body as Record<string, unknown>)["clientGeneratedId"],
    );
  });

  it("409 workout-in-progress-exists resumes the workout and says so", async () => {
    const { fake, start, user } = await setup();
    fake.state.active = makeWorkoutDetail(); // started on another device after this screen loaded

    await user.click(start);

    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("You already had a workout in progress — resumed it.");
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: true, fromRoutine: false });
  });

  it("422 says the device clock looks wrong", async () => {
    const { fake, start, user } = await setup();
    fake.failNext({ method: "POST", path: /\/v1\/workouts$/ }, () =>
      problemResponse(422, "validation-error", { errors: [{ path: "startedAt", message: "Out of range" }] }),
    );

    await user.click(start);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your device clock looks wrong — check the date and time, then try again.",
    );
    await waitFor(() => expect(screen.getByRole("button", { name: "Start empty workout" })).toBeEnabled());
  });
});
