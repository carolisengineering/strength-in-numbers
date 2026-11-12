import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse } from "msw";
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

import { cleanupSendScreen, setupSendScreen, WORKOUT_ID } from "../../test/hevySendHarness";
import { sendFixture } from "../../test/hevySendFakes";
import { editDoneButton, openEditFromSummary } from "../../test/sessionHelpers";
import { makePersonalRecord, makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { WORKOUT_KEYS } from "./queries";

afterEach(() => {
  cleanup();
  cleanupSendScreen();
  cleanupApp();
  observability.track.mockReset();
  observability.reportError.mockReset();
});

const HERE = dirname(fileURLToPath(import.meta.url));
const SECTIONS = ["workouts", "history"] as const;

const follows = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

function expectInOrder(nodes: Node[]) {
  for (let i = 1; i < nodes.length; i += 1) expect(follows(nodes[i - 1]!, nodes[i]!), `item ${i} follows item ${i - 1}`).toBe(true);
}

const finished = (over: Parameters<typeof makeWorkoutDetail>[0] = {}) =>
  makeWorkoutDetail({
    startedAt: "2026-10-02T18:02:00.000Z",
    endedAt: "2026-10-02T19:00:00.000Z",
    exercises: [
      { modality: "weight_reps", name: "Barbell bench press", sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] },
      { modality: "bodyweight_reps", name: "Pull-up", sets: [makeSet({ setNumber: 1, weight: null, weightUnit: null, reps: 12 })] },
    ],
    ...over,
  });

function setup(path: (id: string) => string, over: Parameters<typeof makeWorkoutDetail>[0] = {}) {
  const workout = finished(over);
  const fake = createWorkoutFake({ finished: [workout], active: null });
  prepareApp({ auth, fake });
  const app = renderApp(path(workout.id));
  return { fake, workout, ...app };
}

const menuButton = () => screen.getByRole("button", { name: "Workout menu" });

describe("17.6 AC21 — the order", () => {
  it.each(SECTIONS)("on /app/%s/:id: menu, heading, title, From routine, records, stats, notes, exercises, Hevy, routine note", async (section) => {
    const { detail } = sendFixture({ routineName: "Push Day", routineNotes: "Keep rest short.", notes: "Felt strong." });
    const s = setupSendScreen(auth, { detail });
    s.fake.state.records.push(makePersonalRecord({ workoutId: WORKOUT_ID, exerciseName: "Bench Press" }));
    renderApp(`/app/${section}/${WORKOUT_ID}`);

    const records = await screen.findByRole("region", { name: /record/i });
    const hevy = await screen.findByRole("region", { name: "Hevy" });
    expectInOrder([
      menuButton(),
      screen.getByRole("heading", { name: "Workout summary" }),
      screen.getByText("Push A"),
      screen.getByText("From routine: Push Day"),
      records,
      screen.getByText("duration"),
      screen.getByRole("region", { name: "Workout notes" }),
      screen.getByRole("region", { name: "Bench Press" }),
      screen.getByRole("region", { name: "Row" }),
      hevy,
      screen.getByRole("region", { name: "Routine note" }),
    ]);
  });
});

describe("17.6 AC22 — Edit workout is in the Workout menu", () => {
  it.each(SECTIONS)("on /app/%s/:id: hidden until the menu opens, then Edit workout (secondary) above Delete workout (danger); it navigates with no write", async (section) => {
    const { fake, workout, user, router } = setup((id) => `/app/${section}/${id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    const main = screen.getByRole("main");
    expect(within(main).queryByRole("button", { name: /edit/i })).toBeNull();

    await user.click(menuButton());
    const edit = within(main).getByRole("button", { name: "Edit workout" });
    const del = within(main).getByRole("button", { name: "Delete workout" });
    expect(edit).toHaveAttribute("data-variant", "secondary");
    expect(del).toHaveAttribute("data-variant", "danger");
    expectInOrder([menuButton(), edit, del, screen.getByRole("heading", { name: "Workout summary" })]);

    const writes = () => fake.requests.filter((r) => r.method !== "GET").length;
    const before = writes();
    await user.click(edit);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/${section}/${workout.id}/edit`));
    expect(writes()).toBe(before);
  });

  it("a failed delete keeps its notice when the menu closes; reopened, Edit workout still sits above Delete and navigates", async () => {
    const { fake, workout, user, router } = setup((id) => `/app/workouts/${id}`);
    fake.failNext({ method: "DELETE", path: /\/v1\/workouts\// }, () => HttpResponse.error());
    await screen.findByRole("heading", { name: "Workout summary" });
    await user.click(menuButton());
    await user.click(screen.getByRole("button", { name: "Delete workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Delete this workout?" })).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't delete the workout — try again");

    await user.click(menuButton()); // close
    expect(screen.queryByRole("button", { name: "Edit workout" })).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't delete the workout — try again");

    await user.click(menuButton());
    const edit = screen.getByRole("button", { name: "Edit workout" });
    const del = screen.getByRole("button", { name: "Delete workout" });
    expect(follows(edit, del)).toBe(true);
    // Minor 484: the notice comes after Delete workout, not between the two items, where it read as Edit's error.
    expectInOrder([edit, del, screen.getByRole("alert")]);
    await user.click(edit);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/${workout.id}/edit`));
  });

  it("Done on the edit screen returns to the summary with the menu closed", async () => {
    const { workout, user, router } = setup((id) => `/app/history/${id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    await openEditFromSummary(user);
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/history/${workout.id}/edit`));

    await user.click(await waitFor(() => editDoneButton()));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/history/${workout.id}`));
    expect(await screen.findByRole("button", { name: "Workout menu" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Edit workout" })).toBeNull();
  });

  it("a failed refresh over a cached workout still offers Edit workout", async () => {
    const { fake, workout, user, queryClient } = setup((id) => `/app/workouts/${id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    fake.failNext({ method: "GET", path: new RegExp(`^/v1/workouts/${workout.id}$`) }, () => problemResponse(500, "internal"));
    await queryClient.refetchQueries({ queryKey: WORKOUT_KEYS.detail(workout.id) });

    await user.click(await screen.findByRole("button", { name: "Workout menu" }));
    expect(screen.getByRole("button", { name: "Edit workout" })).toBeInTheDocument();
  });

  it("a failed load with nothing cached has no Workout menu and no Edit workout", async () => {
    const workout = finished();
    const fake = createWorkoutFake({ finished: [workout] });
    fake.failNext({ method: "GET", path: /^\/v1\/workouts\/[^/]+$/ }, () => problemResponse(500, "internal"));
    prepareApp({ auth, fake });
    renderApp(`/app/history/${workout.id}`);
    await screen.findByText("Couldn't load this workout.");
    expect(screen.queryByRole("button", { name: "Workout menu" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit workout" })).toBeNull();
  });
});

describe("17.6 AC23 — the routine note moves to the bottom", () => {
  it.each(SECTIONS)("on /app/%s/:id: a muted label and the text, after the exercises, not in a disclosure", async (section) => {
    setup((id) => `/app/${section}/${id}`, { routineNotes: "Keep rest short on the accessories.", notes: "Felt strong." });
    const note = await screen.findByRole("region", { name: "Routine note" });
    expect(within(note).getByText("Routine note")).toBeInTheDocument();
    expect(within(note).getByText("Keep rest short on the accessories.")).toBeInTheDocument();
    expect(follows(screen.getByRole("region", { name: "Pull-up" }), note)).toBe(true);
    expect(document.querySelector("details")).toBeNull();
  });

  it.each([null, ""])("routineNotes %j draws no label and no region", async (routineNotes) => {
    setup((id) => `/app/workouts/${id}`, { routineNotes });
    await screen.findByRole("region", { name: "Pull-up" });
    expect(screen.queryByRole("region", { name: "Routine note" })).toBeNull();
    expect(screen.queryByText("Routine note")).toBeNull();
  });

  it("a multi-line note keeps its line breaks and long text wraps", async () => {
    setup((id) => `/app/workouts/${id}`, { routineNotes: "Line one\nLine two" });
    const note = await screen.findByRole("region", { name: "Routine note" });
    expect(within(note).getByText(/Line one\s+Line two/).textContent).toBe("Line one\nLine two");
    const sheet = readFileSync(join(HERE, "FinishedWorkoutScreen.module.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    const body = /\.routineNotes\s*\{([^}]*)\}/.exec(sheet)?.[1] ?? "";
    expect(body).toMatch(/white-space:\s*pre-wrap/);
    expect(body).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe("17.6 AC24 — the Hevy block moves unchanged", () => {
  it("the owner sees the Hevy block after the last exercise, with Send to Hevy in it", async () => {
    setupSendScreen(auth);
    renderApp(`/app/history/${WORKOUT_ID}`);
    const hevy = await screen.findByRole("region", { name: "Hevy" });
    expect(follows(screen.getByRole("region", { name: "Row" }), hevy)).toBe(true);
    expect(await within(hevy).findByRole("button", { name: "Send to Hevy" })).toBeInTheDocument();
  });

  it("not the owner and no routine note: nothing follows the last exercise", async () => {
    const s = setupSendScreen(auth, { owner: false });
    renderApp(`/app/history/${WORKOUT_ID}`);
    const last = await screen.findByRole("region", { name: "Row" });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(s.detail.routineNotes ?? null).toBeNull();
    const after = Array.from(screen.getByRole("main").querySelectorAll("*")).filter((el) => !last.contains(el) && follows(last, el));
    expect(after).toEqual([]);
  });
});
