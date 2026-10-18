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

import { exerciseId } from "../../test/catalogFixtures";
import { catalog, pushA } from "../../test/routineFixtures";
import { makeRoutine, makeRoutineItem, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.reportError.mockReset();
  cleanupApp();
});

describe("10.0 AC18 — preview content", () => {
  it("one h1, notes, rows with names, target lines, group in the accessible name, a decorative bracket, actions", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Push A" })).toBeInTheDocument();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByText("Heavy day")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Exercises" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Bench Press, superset 1, 4 × 6–8 · 2:00", // fixture targetRpe 8.5: never shown (17.1 AC4)
      "Barbell Row, superset 1, 4 × 8–10",
      "Overhead Press, 3 × 8",
    ]);
    expect(within(rows[1]!).getByText("Pause at top")).toBeInTheDocument();
    expect(rows[0]!.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(rows[2]!.querySelector("[aria-hidden='true']")).toBeNull();
    expect(screen.getByRole("link", { name: "Edit" })).toHaveAttribute("href", `/app/workouts/routines/${routineId(1)}/edit`);
    expect(screen.getByRole("link", { name: "Back to Workouts" })).toHaveAttribute("href", "/app/workouts");
  });
});

/** True when `b` comes after `a` in document order. */
const before = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

// Issue #98: on a phone the actions sat under the whole exercise list. Back leads the screen, then the
// name, then Start / Edit / Delete (and any start or delete notice), then the notes and the exercises.
describe("#98 — the preview's actions come before the exercises", () => {
  it("orders Back, the h1, Start, Edit, Delete, the notes, then the exercise list", async () => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    const h1 = await screen.findByRole("heading", { level: 1, name: "Push A" });
    const order = [
      screen.getByRole("link", { name: "Back to Workouts" }),
      h1,
      screen.getByRole("button", { name: "Start this routine" }),
      screen.getByRole("link", { name: "Edit" }),
      screen.getByRole("button", { name: "Delete" }),
      screen.getByText("Heavy day"),
      screen.getByRole("list", { name: "Exercises" }),
    ];
    for (let i = 1; i < order.length; i++) expect(before(order[i - 1]!, order[i]!), `item ${i - 1} before item ${i}`).toBe(true);
    expect(screen.getAllByRole("link", { name: "Back to Workouts" })).toHaveLength(1);
  });

  it("a start failure shows its notice under the actions, above the exercises", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "POST", path: /^\/v1\/workouts$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}`);
    await user.click(await screen.findByRole("button", { name: "Start this routine" }));
    const alert = await screen.findByRole("alert");
    expect(before(screen.getByRole("button", { name: "Delete" }), alert)).toBe(true);
    expect(before(alert, screen.getByRole("list", { name: "Exercises" }))).toBe(true);
  });

  it.each([routineId(9)])("the gone screen (%s) also leads with Back", async (id) => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${id}`);
    const message = await screen.findByText("That routine no longer exists");
    const back = screen.getByRole("link", { name: "Back to Workouts" });
    expect(before(back, screen.getByRole("heading", { level: 1, name: "Routine" }))).toBe(true);
    expect(before(back, message)).toBe(true);
  });
});

describe("10.0 AC30 — retired and removed exercises on the preview", () => {
  it("after the catalog syncs, a retired or deleted exercise shows as Removed exercise with the marker", async () => {
    const routine = makeRoutine({
      id: routineId(5),
      name: "Odd",
      items: [makeRoutineItem({ position: 0, exerciseId: exerciseId(4) }), makeRoutineItem({ position: 1, exerciseId: exerciseId(99) })],
    });
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [routine] }) });
    renderApp(`/app/workouts/routines/${routineId(5)}`);
    const list = await screen.findByRole("list", { name: "Exercises" });
    await waitFor(() => expect(within(list).getAllByText("No longer available — remove or replace")).toHaveLength(2));
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Removed exercise, no longer available",
      "Removed exercise, no longer available",
    ]);
  });
});

describe("10.0 AC19 — preview loading states", () => {
  it("a list-cache hit makes no detail request", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    await screen.findByRole("heading", { level: 1, name: "Push A" });
    expect(fake.requests.filter((r) => r.path === `/v1/routines/${routineId(1)}`)).toHaveLength(0);
  });

  it("a deep link whose list failed reads detail", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    fake.failNext({ method: "GET", path: /^\/v1\/routines$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, catalog, fake });
    renderApp(`/app/workouts/routines/${routineId(1)}`);
    expect(await screen.findByRole("heading", { level: 1, name: "Push A" })).toBeInTheDocument();
    expect(fake.requests.some((r) => r.path === `/v1/routines/${routineId(1)}`)).toBe(true);
  });

  it.each([routineId(9), "not-a-uuid"])("404 for %s says it no longer exists, unreported", async (id) => {
    prepareApp({ auth, catalog, fake: createWorkoutFake({ catalog, routines: [pushA] }) });
    renderApp(`/app/workouts/routines/${id}`);
    expect(await screen.findByText("That routine no longer exists")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to Workouts" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("another failure: notice + Retry + request id, reported when unknown", async () => {
    const fake = createWorkoutFake({ catalog });
    fake.failNext({ method: "GET", path: /^\/v1\/routines\/./ }, () => problemResponse(418, "teapot"));
    prepareApp({ auth, catalog, fake });
    const { user } = renderApp(`/app/workouts/routines/${routineId(1)}`);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this routine");
    expect(alert).toHaveTextContent(/Request ID: \S+/);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "routines", op: "load-routine" });
    await user.click(within(alert).getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("That routine no longer exists")).toBeInTheDocument();
  });
});
