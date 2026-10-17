import type { PlannedSet } from "@sin/core";
import { onlineManager } from "@tanstack/react-query";
import { act, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Spec 17.1 AC49: wrap the card and panel components to count renders. A wrapper component calling the real one as a
// function keeps hooks valid (the wrapper is the component React sees).
const renders = vi.hoisted(() => ({ card: 0, collapsed: 0, entry: 0 }));
vi.mock("./ExerciseCard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./ExerciseCard")>();
  return {
    ...actual,
    ExerciseCard: (p: Parameters<typeof actual.ExerciseCard>[0]) => {
      renders.card += 1;
      return actual.ExerciseCard(p);
    },
    CollapsedExercise: (p: Parameters<typeof actual.CollapsedExercise>[0]) => {
      renders.collapsed += 1;
      return actual.CollapsedExercise(p);
    },
  };
});
vi.mock("./EntryRow", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./EntryRow")>();
  return {
    ...actual,
    EntryRow: (p: Parameters<typeof actual.EntryRow>[0]) => {
      renders.entry += 1;
      return actual.EntryRow(p);
    },
  };
});

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
import { makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

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
/** One log from the bar, waited on as ActiveSession.bar.test.tsx does; then past the 600 ms double-tap window. */
async function logOnce(user: User, fake: Fake) {
  const before = setPosts(fake).length;
  await user.click(bar());
  await waitFor(() => expect(setPosts(fake)).toHaveLength(before + 1));
  advance(1000); // past the double-tap window; the tick also re-renders the readout
}


describe("17.1 AC49 — the tick is isolated", () => {
  it("five exercises, a running rest: 5 s of ticks re-render no card and no entry panel", async () => {
    const { user, fake } = await setup(["A", "B", "C", "D", "E"].map((n) => ex(n)));
    await logOnce(user, fake);
    expect(screen.getByRole("timer")).toBeInTheDocument();
    renders.card = renders.collapsed = renders.entry = 0;
    for (let i = 0; i < 5; i += 1) advance(1000);
    expect(screen.getByRole("timer")).toHaveTextContent("Rest 1:54");
    expect(renders).toEqual({ card: 0, collapsed: 0, entry: 0 });
  });
});
