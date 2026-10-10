import { screen, waitFor, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { HttpResponse } from "msw";
import { makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const PATH = `/app/workouts/routines/${routineId(1)}`;
const starts = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && r.path === "/v1/workouts");

describe("10.0 AC18 — preview actions", () => {
  it("offers Start this routine and Delete", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(PATH);
    expect(await screen.findByRole("button", { name: "Start this routine" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });
});

describe("10.0 AC20 — start success", () => {
  it("sends routineId, ignores a double tap, replaces to the session, copies in order with groups", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    const start = await screen.findByRole("button", { name: "Start this routine" });
    await user.dblClick(start);
    expect(await screen.findByRole("heading", { name: "Workout" })).toBeInTheDocument();
    expect(starts(fake)).toHaveLength(1);
    expect(starts(fake)[0]!.body).toMatchObject({ routineId: routineId(1) });
    expect(router.state.location.pathname).toBe("/app/workouts");
    expect(router.state.historyAction).toBe("REPLACE");
    expect(fake.state.active?.exercises.map((e) => [e.exerciseNameSnapshot, e.supersetGroup])).toEqual([
      ["Bench Press", 1],
      ["Barbell Row", 1],
      ["Overhead Press", null],
    ]);
  });

  it("a retry reuses the key; a fresh mount mints a new one", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "POST", path: /^\/v1\/workouts$/ }, () => HttpResponse.error());
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    await user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { name: "Workout" });
    const [first, second] = starts(fake);
    expect((first!.body as { clientGeneratedId: string }).clientGeneratedId).toBe((second!.body as { clientGeneratedId: string }).clientGeneratedId);

    fake.state.active = null;
    await router.navigate(PATH);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    await waitFor(() => expect(starts(fake)).toHaveLength(3));
    expect((starts(fake)[2]!.body as { clientGeneratedId: string }).clientGeneratedId).not.toBe(
      (first!.body as { clientGeneratedId: string }).clientGeneratedId,
    );
  });
});

describe("10.0 AC21 — an active workout blocks Start", () => {
  it("shows the message and link instead; Edit and Delete stay", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA], active: makeWorkoutDetail() }) });
    renderApp(PATH);
    expect(await screen.findByText("Finish your current workout first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to your workout" })).toHaveAttribute("href", "/app/workouts");
    expect(screen.queryByRole("button", { name: "Start this routine" })).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("a failed active read still shows Start", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts\/active$/ }, () => problemResponse(500, "internal"), 5);
    prepareApp({ auth, catalog, fake });
    renderApp(PATH);
    expect(await screen.findByRole("button", { name: "Start this routine" })).toBeInTheDocument();
  });
});

describe("10.0 AC22 — start failures", () => {
  it("(a) in-progress race: adopt, track, notice on the session", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(PATH);
    const start = await screen.findByRole("button", { name: "Start this routine" });
    fake.state.active = makeWorkoutDetail(); // someone else started one
    await user.click(start);
    expect(await screen.findByText("You already had a workout in progress — resumed it. The routine wasn't applied.")).toBeInTheDocument();
    expect(observability.track).toHaveBeenCalledWith("workout_started", { resumed: true, fromRoutine: true });
  });

  it("(b) retired: message with an Edit action", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "POST", path: /^\/v1\/workouts$/ }, () =>
      problemResponse(409, "exercise-retired", { errors: [{ path: "routineId", message: "x" }] }),
    );
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("One of this routine's exercises is no longer available. Edit the routine to replace it.");
    await user.click(within(alert).getByRole("button", { name: "Edit" }));
    expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}/edit`);
  });

  it("(c) 404: back to Start with the notice, list refetched", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    const start = await screen.findByRole("button", { name: "Start this routine" });
    fake.state.routines.clear();
    await user.click(start);
    expect(await screen.findByText("That routine no longer exists")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/app/workouts");
    await waitFor(() => expect(screen.queryByRole("link", { name: /Push A/ })).toBeNull());
  });

  it("(d) 422 shows the clock message; (e) 429 / other: try again with the same key", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "POST", path: /^\/v1\/workouts$/ }, () => problemResponse(422, "validation-error", { errors: [{ path: "startedAt", message: "x" }] }));
    fake.failNext({ method: "POST", path: /^\/v1\/workouts$/ }, () => problemResponse(429, "rate-limited"));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your device clock looks wrong");
    await user.click(screen.getByRole("button", { name: "Start this routine" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't start your workout — try again.");
    expect(screen.getByRole("alert")).toHaveTextContent(/Request ID: \S+/);
  });
});

describe("10.0 AC24 — delete", () => {
  it("confirms, deletes, removes from the list, returns to Start", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete Push A?" });
    expect(dialog).toHaveTextContent("Past workouts keep their history.");
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
    expect(fake.state.routines.size).toBe(0);
    expect(fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/routines/${routineId(1)}`)).toHaveLength(0);
    expect(await screen.findByText("Routines are reusable workouts — build one, then start it in a tap.")).toBeInTheDocument();
  });

  it("a 404 counts as success; Cancel changes nothing", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(fake.requests.some((r) => r.method === "DELETE")).toBe(false);
    fake.state.routines.clear();
    await user.click(screen.getByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/app/workouts"));
  });

  it.each([
    [() => HttpResponse.error(), "You're offline — try again when connected"],
    [() => problemResponse(429, "rate-limited"), "Too many changes in a short time — wait a minute and try again"],
    [() => problemResponse(500, "internal"), "Couldn't delete this routine — try again."],
  ])("failure keeps the page with a notice", async (response, text) => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "DELETE", path: /^\/v1\/routines\// }, response);
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(PATH);
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(router.state.location.pathname).toBe(PATH);
  });
});
