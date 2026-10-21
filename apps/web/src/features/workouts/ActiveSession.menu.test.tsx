import type { PlannedSet } from "@sin/core";
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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });
const logged = (n: number) => Array.from({ length: n }, (_, i) => makeSet({ setNumber: i + 1 }));

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const openMenu = async (user: Awaited<ReturnType<typeof setup>>["user"]) => user.click(screen.getByRole("button", { name: "Workout menu" }));
const finishes = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH" && /\/v1\/workouts\/[^/]+$/.test(r.path));

describe("17.1 AC32 — the Workout menu", () => {
  it("reveals End workout early and Discard workout inline; Discard's dialog is unchanged", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(2), sets: logged(1) })]);
    const toggle = screen.getByRole("button", { name: "Workout menu" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Discard workout" })).toBeNull();
    await openMenu(user);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "End workout early" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Discard workout" }));
    expect(screen.getByRole("dialog", { name: "Discard this workout?" })).toBeInTheDocument();
  });
});

describe("17.1 AC33 — End workout early", () => {
  it("lists the unlogged planned sets by exercise, then finishes through the same path", async () => {
    const { fake, user } = await setup([ex("Bench Press", { plannedSets: planned(3), sets: logged(3) }), ex("Overhead Press", { plannedSets: planned(3) }), ex("Row", { plannedSets: planned(3), sets: logged(1) })]);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    const dialog = screen.getByRole("dialog", { name: "End workout early?" });
    expect(within(dialog).getByText("Overhead Press · 3 sets")).toBeInTheDocument();
    expect(within(dialog).getByText("Row · 2 sets")).toBeInTheDocument();
    expect(within(dialog).getByText("5 planned sets not logged")).toBeInTheDocument();
    expect(within(dialog).getByText("Unlogged sets aren't saved.")).toBeInTheDocument(); // 17.2 AC2
    await user.click(within(dialog).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(finishes(fake)).toHaveLength(1));
  });

  it("is disabled with 'Log a set first' when nothing is logged", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(2) })]);
    await openMenu(user);
    const item = screen.getByRole("button", { name: "End workout early" });
    expect(item).toBeDisabled();
    expect(item).toHaveAccessibleDescription("Log a set first");
  });

  it("shares Finish's failure handling (a clock refusal shows the same message)", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(2), sets: logged(1) })]);
    fake.failNext({ method: "PATCH", path: /\/v1\/workouts\// }, () => problemResponse(422, "validation-error", { errors: [{ path: "endedAt", message: "x" }] }));
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    expect(await screen.findByText(/Your device clock looks wrong/)).toBeInTheDocument();
  });

  it("with nothing planned left (or no plan) the item says Finish workout and opens today's dialog", async () => {
    const { user } = await setup([ex("A", { sets: logged(1) })]);
    await openMenu(user);
    // The menu sits above the list, so its item is the first "Finish workout" in DOM order (the list-end one follows).
    const items = screen.getAllByRole("button", { name: "Finish workout" });
    expect(items).toHaveLength(2);
    await user.click(items[0]!);
    expect(screen.getByRole("dialog", { name: "Finish workout?" })).toBeInTheDocument();
  });
});

describe("17.1 AC53 — workout_finished gains endedEarly and unloggedPlannedSets", () => {
  it("an early end reports true and the count; no other prop is added (amended by 18.0 AC43)", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(3), sets: logged(1) })]);
    await openMenu(user);
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    await user.click(within(screen.getByRole("dialog", { name: "End workout early?" })).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.anything()));
    const props = observability.track.mock.calls.find(([e]) => e === "workout_finished")![1];
    expect(props).toMatchObject({ endedEarly: true, unloggedPlannedSets: 2 });
    expect(Object.keys(props).sort()).toEqual(["durationMin", "endedEarly", "exerciseCount", "hadPlannedDuration", "setCount", "unloggedPlannedSets"]);
  });

  it("a normal finish reports false and 0", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(1), sets: logged(1) })]);
    await user.click(screen.getByRole("button", { name: "Finish workout" }));
    await user.click(within(screen.getByRole("dialog", { name: "Finish workout?" })).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ endedEarly: false, unloggedPlannedSets: 0 })));
  });
});
