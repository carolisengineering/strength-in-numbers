// apps/web/src/features/routines/RoutinesSection.test.tsx
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { HttpResponse } from "msw";
import { ROUTINES_PER_USER_MAX } from "@sin/core";
import { makeRoutine, makeRoutineItem, makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { EMPTY_ROUTINES, LIMIT_MESSAGE } from "./messages";

afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

const pushA = makeRoutine({
  id: routineId(1),
  name: "Push A",
  items: [makeRoutineItem({ position: 0, supersetGroup: 1 }), makeRoutineItem({ position: 1, supersetGroup: 1 }), makeRoutineItem({ position: 2 })],
});
const pullB = makeRoutine({ id: routineId(2), name: "Pull B" });

describe("10.0 AC15 — the Routines section", () => {
  it("lists routines as links in server order under an h2, then New routine", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ routines: [pushA, pullB] }) });
    renderApp("/app/workouts");
    expect(await screen.findByRole("heading", { level: 2, name: "Routines" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Routines" });
    const links = within(list).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Pull B1 exercise", "Push A3 exercises · 1 superset"]);
    expect(links[1]).toHaveAttribute("href", `/app/workouts/routines/${routineId(1)}`);
    expect(screen.getByRole("link", { name: "New routine" })).toHaveAttribute("href", "/app/workouts/routines/new");
    expect(screen.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  });

  it("is not shown while a workout is active", async () => {
    prepareApp({ auth, fake: createWorkoutFake({ active: makeWorkoutDetail(), routines: [pushA] }) });
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(screen.queryByRole("heading", { name: "Routines" })).toBeNull();
  });
});

describe("10.0 AC16 — section states", () => {
  it("pending shows a status line while Start stays usable", async () => {
    const fake = createWorkoutFake({ routines: [pushA] });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => new Promise<Response>(() => {}) as unknown as Response);
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    expect(await screen.findByText("Loading routines…")).toHaveAttribute("role", "status");
    expect(screen.getByRole("button", { name: "Start empty workout" })).toBeEnabled();
  });

  it("empty shows the explanation and New routine", async () => {
    prepareApp({ auth, fake: createWorkoutFake() });
    renderApp("/app/workouts");
    expect(await screen.findByText(EMPTY_ROUTINES)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New routine" })).toBeInTheDocument();
  });

  it("failure with no data: notice + Retry + request id; offline too; Retry refetches", async () => {
    const fake = createWorkoutFake({ routines: [pushA] });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => HttpResponse.error());
    prepareApp({ auth, fake });
    const { user } = renderApp("/app/workouts");
    const notice = await screen.findByRole("alert");
    expect(notice).toHaveTextContent("Couldn't load routines");
    await user.click(within(notice).getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("link", { name: /Push A/ })).toBeInTheDocument();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("an unknown failure is reported with static tags", async () => {
    const fake = createWorkoutFake();
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    expect(await screen.findByRole("alert")).toHaveTextContent(/Request ID: \S+/);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "routines", op: "load-routines" });
  });
});

describe("10.0 AC17 — the 50-routine limit", () => {
  it("New routine becomes a disabled control with the message", async () => {
    const routines = Array.from({ length: ROUTINES_PER_USER_MAX }, (_, i) => makeRoutine({ id: routineId(i + 1), name: `R${String(i).padStart(2, "0")}` }));
    prepareApp({ auth, fake: createWorkoutFake({ routines }) });
    renderApp("/app/workouts");
    expect(await screen.findByRole("button", { name: "New routine" })).toBeDisabled();
    expect(screen.queryByRole("link", { name: "New routine" })).toBeNull();
    expect(screen.getByText(LIMIT_MESSAGE)).toBeInTheDocument();
  });
});

describe("10.0 AC16 — a failed refresh keeps the rows", () => {
  it("shows Couldn't refresh your routines over cached rows", async () => {
    const fake = createWorkoutFake({ routines: [pushA] });
    prepareApp({ auth, fake });
    const { queryClient, user } = renderApp("/app/workouts");
    await screen.findByRole("link", { name: /Push A/ });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => HttpResponse.error());
    await queryClient.refetchQueries({ queryKey: ["routines", "list"] });
    expect(await screen.findByText("Couldn't refresh your routines")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Push A/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
  });
});
