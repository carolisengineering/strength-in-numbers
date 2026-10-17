import type { PlannedSet } from "@sin/core";
import { onlineManager } from "@tanstack/react-query";
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { discardWorkout } from "../../test/sessionHelpers";
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { localStorageAdapter } from "../../storage/storage";
import { REST_KEY } from "./restStore";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const planned = (types: PlannedSet["setType"][]): PlannedSet[] =>
  types.map((setType) => ({ setType, repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, restSeconds: 120, plannedSets: planned(["working", "working", "working"]), ...o });

let t = Date.parse("2026-10-16T10:00:00.000Z");
const advance = (ms: number) => {
  t += ms;
  act(() => vi.advanceTimersByTime(ms));
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
  vi.spyOn(Date, "now").mockImplementation(() => t);
});
afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
  vi.restoreAllMocks();
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
type Fake = ReturnType<typeof createWorkoutFake>;
type User = ReturnType<typeof renderApp>["user"];
const bar = () => within(screen.getByTestId("session-bar")).getByRole("button", { name: /^Log / });
const setPosts = (fake: Fake) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));
const finishes = (fake: Fake) => fake.requests.filter((r) => r.method === "PATCH" && /\/v1\/workouts\//.test(r.path));
/** One log from the bar, waited on as ActiveSession.bar.test.tsx does; then past the 600 ms double-tap window. */
async function logOnce(user: User, fake: Fake) {
  const before = setPosts(fake).length;
  await user.click(bar());
  await waitFor(() => expect(setPosts(fake)).toHaveLength(before + 1));
  advance(1000); // past the double-tap window; the tick also re-renders the readout
}
const readout = () => screen.queryByRole("timer");
const fill = () => screen.queryByTestId("rest-line-fill");
const stored = () => localStorageAdapter().get(REST_KEY);

// Clock arithmetic used below: logOnce starts the rest at t0 and leaves t at t0 + 1 s, so a 120 s rest reads 1:59.

describe("17.1 AC41 / AC44 / AC48 — a working set starts the exercise rest: readout in the panel, line at the top", () => {
  it("counts from the clock, with an aria-hidden line that fills", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    expect(readout()).toHaveTextContent("Rest 1:59");
    advance(30_000);
    expect(readout()).toHaveTextContent("Rest 1:29");
    expect(readout()).not.toHaveAttribute("aria-live");
    expect(screen.getByTestId("rest-line-slot")).toHaveAttribute("aria-hidden", "true");
    expect(fill()).toHaveAttribute("max", "120");
    expect(fill()).toHaveAttribute("value", "31"); // 120 - 89 s left
  });

  it("at zero the readout says Ready, the line is gone, and 'Rest over' is announced outside aria-hidden", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    advance(120_000);
    expect(readout()).toHaveTextContent("Ready");
    expect(fill()).toBeNull();
    const said = screen.getByText("Rest over");
    expect(said.closest("[role='status']")).not.toBeNull();
    expect(said.closest("[aria-hidden='true']")).toBeNull();
  });
});

describe("17.1 AC42 — every log replaces or clears the timer", () => {
  it("a warm-up log during a rest clears it without announcing 'Rest over' (Review Focus 1)", async () => {
    const { user, fake } = await setup([ex("A", { plannedSets: planned(["working", "warmup", "working"]) }), ex("B")]);
    await logOnce(user, fake);
    expect(readout()).not.toBeNull();
    await logOnce(user, fake); // set 2 is the planned warm-up; the 10.2 prefill carries its type
    expect(readout()).toBeNull();
    expect(fill()).toBeNull();
    expect(stored()).toBeNull();
    advance(5000);
    expect(screen.queryByText("Rest over")).toBeNull();
  });

  it("a second working log restarts at the full length", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    advance(60_000);
    await logOnce(user, fake);
    expect(readout()).toHaveTextContent("Rest 1:59");
  });

  it("a mid-round superset member starts none; the round end does", async () => {
    const { user, fake } = await setup([ex("A", { supersetGroup: 1 }), ex("B", { supersetGroup: 1 })]);
    await logOnce(user, fake); // A1 → B current, no rest
    expect(readout()).toBeNull();
    await logOnce(user, fake); // B1 completes the round → rest
    expect(readout()).toHaveTextContent("Rest 1:59");
  });
});

describe("17.1 AC45 — the bar and the clock do not change during rest", () => {
  it("the bar still reads Log … and one tap logs; the elapsed clock stays", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    expect(bar()).toHaveAccessibleName(/^Log .* for A$/);
    await logOnce(user, fake);
    expect(setPosts(fake)).toHaveLength(2);
    expect(screen.getByText(/^Elapsed/)).toBeInTheDocument();
  });
});

describe("17.1 AC46 — restored after a reload (Review Focus 4)", () => {
  it("a remount mid-rest resumes with the right time left", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    cleanup(); // RTL's unmount; localStorage and the fake are untouched (as EntryRow.drafts.test.tsx's 06.5 AC7 test)
    t += 30_000;
    renderApp("/app/workouts");
    expect(await screen.findByRole("timer")).toHaveTextContent("Rest 1:29");
  });

  it("a remount after the rest ended shows nothing, not Ready", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    cleanup();
    t += 200_000;
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(readout()).toBeNull();
    expect(stored()).toBeNull();
  });
});

describe("17.1 AC47 — finish, discard and gone remove the key", () => {
  it("discard success removes it", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    expect(stored()).not.toBeNull();
    await discardWorkout(user);
    await user.click(within(screen.getByRole("dialog", { name: "Discard this workout?" })).getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(stored()).toBeNull());
  });

  it("finish (End workout early, during a rest) removes it", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(finishes(fake)).toHaveLength(1));
    await waitFor(() => expect(stored()).toBeNull());
  });

  it("the gone path removes it", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(404, "not-found"));
    fake.state.active = null;
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    expect(await screen.findByRole("heading", { name: "Start a workout" })).toBeInTheDocument();
    expect(stored()).toBeNull();
  });
});

describe("17.1 AC50 — a rest never blocks anything", () => {
  it("the Workout menu and Add exercise work during rest; leaving and returning keeps the same rest", async () => {
    const { user, fake, router } = await setup([ex("A"), ex("B")]);
    await logOnce(user, fake);
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    expect(screen.getByRole("button", { name: "End workout early" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add exercise" })).toBeEnabled();
    await act(() => router.navigate("/app/profile"));
    expect(readout()).toBeNull();
    t += 10_000;
    await act(() => router.navigate("/app/workouts"));
    expect(await screen.findByRole("timer")).toHaveTextContent("Rest 1:49");
  });
});

describe("17.1 AC41 — an offline (queued) log starts the rest like an online one (Review Focus 5)", () => {
  it("rests after a queued log", async () => {
    const { user, fake } = await setup([ex("A"), ex("B")]);
    // As ActiveSession.offline.test.tsx's goOffline (and its afterEach: onlineManager.setOnline(true)).
    fake.setOffline(true);
    window.dispatchEvent(new Event("offline"));
    await user.click(bar());
    expect(await screen.findByRole("timer")).toHaveTextContent("Rest 2:00");
  });
});
