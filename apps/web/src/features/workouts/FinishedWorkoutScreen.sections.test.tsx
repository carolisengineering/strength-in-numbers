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

import { markupOf } from "../../test/markup";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

const FINISHED = "2026-10-02T11:00:00.000Z";
const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, ...extra });
/** The exercises container: heading → its <section> → the slot div → the container. */
const exercisesBlock = () => screen.getByRole("heading", { level: 2, name: "A" }).closest("section")!.parentElement!.parentElement!;

describe("10.3 AC32 — no sections, no change (finished screen)", () => {
  it.each([["/app/workouts/"], ["/app/history/"]])("%s<id>: the exercise blocks render exactly as in 10.2 (baseline)", async (prefix) => {
    const detail = makeWorkoutDetail({
      id: "70000000-0000-4000-8000-000000000001",
      endedAt: FINISHED,
      routineName: "Push B",
      exercises: [ex("A", null, { supersetGroup: 1, notes: "Pause", sets: [makeSet({ setNumber: 1 })] }), ex("B", null, { supersetGroup: 1 }), ex("C")],
    });
    prepareApp({ auth, fake: createWorkoutFake({ finished: [detail] }) });
    renderApp(`${prefix}${detail.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    expect(markupOf(exercisesBlock())).toMatchSnapshot();
  });
});

describe("10.3 AC31 — finished workout and History", () => {
  const detail = () =>
    makeWorkoutDetail({
      id: "70000000-0000-4000-8000-000000000002",
      endedAt: FINISHED,
      routineName: "Push B",
      routineNotes: "Keep it short",
      sections: [{ name: "Warm-up", notes: "5 min rower" }, { name: "Main" }],
      exercises: [ex("Bench", 1, { supersetGroup: 1, notes: "Pause every rep" }), ex("Row", 1, { supersetGroup: 1 }), ex("Cable curl")],
    });

  it.each([["/app/workouts/"], ["/app/history/"]])("%s<id> shows sections, the routine note, 'Other exercises' and the exercise notes, read-only", async (prefix) => {
    const d = detail();
    prepareApp({ auth, fake: createWorkoutFake({ finished: [d] }) });
    renderApp(`${prefix}${d.id}`);
    await screen.findByRole("heading", { name: "Workout summary" });
    const names = screen.getAllByRole("region").filter((r) => r.querySelector("h1") === null).flatMap((r) => within(r).queryAllByRole("heading", { level: 2 }).slice(0, 1).map((h) => h.textContent));
    expect(names).toContain("Warm-up");
    expect(names).toContain("Main");
    expect(names).toContain("Other exercises");
    expect(within(screen.getByRole("region", { name: "Warm-up" })).getByText("5 min rower")).toBeInTheDocument(); // empty section: heading and note
    const from = screen.getByText("From routine: Push B");
    expect(from.nextElementSibling?.tagName).toBe("P");
    expect(from.nextElementSibling).toHaveTextContent("Keep it short"); // plain paragraph, no collapse
    expect(screen.queryByRole("button", { name: /routine note/i })).toBeNull();
    expect(screen.getByText("Pause every rep")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /note/i })).toBeNull(); // no Note action on a finished workout
    const main = screen.getByRole("region", { name: "Main" });
    expect(Array.from(main.querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"))).toEqual(["first", "middle", "last"]);
  });
});
