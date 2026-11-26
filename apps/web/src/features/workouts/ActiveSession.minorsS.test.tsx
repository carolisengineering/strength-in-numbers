import type { PlannedSet } from "@sin/core";
import { screen, waitFor, within } from "@testing-library/react";
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

// A held log, so a test can act between the tap and the log's success, and a held delete, so one can act between an
// Undo tap and its delete reaching the queue (minor 767). Everything else about the mutations is real.
const hold = vi.hoisted(() => ({ gate: null as Promise<void> | null, deleteGate: null as Promise<void> | null }));
vi.mock("./useWorkoutMutations", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./useWorkoutMutations")>();
  return {
    ...actual,
    useCreateSet: () => {
      const real = actual.useCreateSet();
      return {
        ...real,
        mutateAsync: async (variables: Parameters<typeof real.mutateAsync>[0]) => {
          if (hold.gate) await hold.gate;
          return real.mutateAsync(variables);
        },
      };
    },
    useDeleteSet: () => {
      const real = actual.useDeleteSet();
      return {
        ...real,
        mutateAsync: async (variables: Parameters<typeof real.mutateAsync>[0]) => {
          if (hold.deleteGate) await hold.deleteGate;
          return real.mutateAsync(variables);
        },
      };
    },
  };
});

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { card, logButton, makeCurrent } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });

const scroll = vi.fn();
beforeEach(() => {
  Element.prototype.scrollIntoView = scroll;
  scroll.mockReset();
  hold.gate = null;
  hold.deleteGate = null;
});
afterEach(() => cleanupApp());

const panel = (name: string | RegExp) => within(card(name)).getByRole("form");
const scrolled = () => scroll.mock.contexts as unknown[];

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  await waitFor(() => expect(scroll).toHaveBeenCalled()); // the screen's one reveal on open (17.1 AC9)
  scroll.mockClear();
  return { fake, ...app };
}

describe("minor 713 — an Undo's reveal belongs to the lifter's last choice", () => {
  it("Undo selects its card and then reveals it: the reveal isn't dropped by Undo's own choice", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) }), ex("B", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    const undo = await screen.findByRole("button", { name: /^Undo set 1/ });
    scroll.mockClear();
    await user.click(undo);
    await waitFor(() => expect(scrolled()).toContain(panel(/^A/)));
  });
});

describe("minor 767 — Undo doesn't pull the lifter back from a card they moved to", () => {
  it("minor 767: Undo on A, then a tap on B before the delete lands: B stays current", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3) }), ex("B", { plannedSets: planned(3) })]);
    await user.click(logButton("A"));
    const undo = await screen.findByRole("button", { name: /^Undo set 1/ });
    const gate = deferred<void>();
    hold.deleteGate = gate.promise;
    await user.click(undo);
    await makeCurrent(user, "B");
    gate.resolve();
    // The DELETE is sent once the delete is queued, which is after the point where Undo would move.
    await waitFor(() => expect(fake.requests.some((r) => r.method === "DELETE" && r.path.startsWith("/v1/sets/"))).toBe(true));
    await new Promise((r) => setTimeout(r, 50)); // let a wrong move render if one is coming
    expect(within(card(/^B/)).getByRole("form", { name: "Log a set of B" })).toBeInTheDocument();
    expect(within(card(/^A/)).queryByRole("form")).toBeNull();
  });
});

const undoButton = () => screen.queryByRole("button", { name: /^Undo set / });
const firstSet = () => makeSet({ setNumber: 1, weight: 47.5, weightKg: 47.5, weightUnit: "kg", reps: 6 });
const setPosts = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"));

describe("minor 711 — every open card sheet keeps the Undo offer off", () => {
  it("a log that lands while a set's sheet is open offers no Undo, then or after the sheet closes", async () => {
    const { fake, user } = await setup([ex("A", { sets: [firstSet()], plannedSets: planned(3) }), ex("B")]);
    await makeCurrent(user, "A");
    const gate = deferred<void>();
    hold.gate = gate.promise;
    await user.click(logButton("A"));
    await user.click(within(card(/^A/)).getAllByRole("button", { name: /47\.5 kg × 6/ })[0]!);
    await screen.findByRole("dialog");
    gate.resolve();
    await waitFor(() => expect(setPosts(fake)).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 50)); // let a wrong offer render if one is coming
    expect(undoButton()).toBeNull();
    // jsdom's dialog shim ignores Escape; the sheet's own Cancel closes it.
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(undoButton()).toBeNull();
  });

  it("final review: the Workout menu left open (an inline disclosure) doesn't keep Undo off for later logs", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3) }), ex("B")]);
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    expect(screen.getByRole("button", { name: "Workout menu" })).toHaveAttribute("aria-expanded", "true");
    await user.click(logButton("A"));
    await waitFor(() => expect(undoButton()).not.toBeNull());
  });

  it("Review Focus 2: a card that unmounts with its sheet open doesn't keep Undo off", async () => {
    const { fake, user, queryClient } = await setup([ex("A", { sets: [firstSet()] }), ex("B", { plannedSets: planned(3) })]);
    await makeCurrent(user, "A");
    await user.click(within(card(/^A/)).getAllByRole("button", { name: /47\.5 kg × 6/ })[0]!);
    await screen.findByRole("dialog");
    // Removed on another device: the next read drops A's card, its open sheet with it.
    fake.state.active = { ...fake.state.active!, exercises: fake.state.active!.exercises.filter((e) => e.exerciseNameSnapshot !== "A") };
    await queryClient.invalidateQueries({ queryKey: ["workouts", "active"] });
    await waitFor(() => expect(screen.queryByRole("article", { name: /^A/ })).toBeNull());
    await makeCurrent(user, "B");
    await user.click(logButton("B"));
    await waitFor(() => expect(undoButton()).not.toBeNull());
  });
});
