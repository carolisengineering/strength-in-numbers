import { cleanup, screen, within } from "@testing-library/react";
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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { markupOf } from "../../test/markup";
import { makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  ...extra,
});

async function setup(opts: WorkoutDetailOptions) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const cards = () => screen.getAllByRole("article")[0]!.parentElement!.parentElement!; // article → slot → the cards container

describe("10.3 AC32 — no sections, no change", () => {
  it("a manual workout and a routine workout without sections render the 10.2 cards exactly (baseline recorded before Spec 10.3's edits)", async () => {
    await setup({
      exercises: [
        ex("A", null, { supersetGroup: 1, notes: "Pause", targetSets: 4, targetRepsLow: 6, targetRepsHigh: 8, sets: [makeSet({ setNumber: 1 })] }),
        ex("B", null, { supersetGroup: 1 }),
        ex("C"),
      ],
    });
    expect(within(document.body).queryAllByRole("region").filter((r) => r.getAttribute("aria-labelledby") !== null && !r.querySelector("h1"))).toEqual([]);
    // Spec 17.1 AC9: re-recorded for the collapsed rows.
    // Spec 17.1 AC18–AC23: re-recorded for the stepper panel.
    expect(markupOf(cards())).toMatchSnapshot("manual");
    cleanup();
    await setup({ routineName: "Push B", exercises: [ex("A"), ex("B", null, { supersetGroup: 2 }), ex("C", null, { supersetGroup: 2 })] });
    // Spec 17.1 AC9: re-recorded for the collapsed rows.
    // Spec 17.1 AC18–AC23: re-recorded for the stepper panel.
    expect(markupOf(cards())).toMatchSnapshot("routine, no sections");
  });
});

/** The page itself is a labeled region (it holds the h1); only the session's own section / note regions count. */
const sectionRegions = () => screen.getAllByRole("region").filter((r) => r.querySelector("h1") === null);
const regionNames = () => sectionRegions().map((r) => within(r).getAllByRole("heading", { level: 2 })[0]!.textContent);

const sectioned = (): WorkoutDetailOptions => ({
  routineName: "Push B",
  routineNotes: "Keep it short",
  sections: [{ name: "Warm-up", notes: "5 min rower" }, { name: "Main" }],
  exercises: [
    ex("Face pull"),
    ex("Bench", 1, { supersetGroup: 1 }),
    ex("Row", 1, { supersetGroup: 1 }),
    ex("Cable curl"), // added during the workout: a loose tail
  ],
});

describe("10.3 AC24 — session layout", () => {
  it("segments: headingless loose start, the empty section's heading and note, Main's cards, 'Other exercises' for the tail", async () => {
    await setup(sectioned());
    expect(regionNames()).toEqual(["Routine note · Push B", "Warm-up", "Main", "Other exercises"]);
    const warm = screen.getByRole("region", { name: "Warm-up" });
    expect(within(warm).getByText("5 min rower")).toBeInTheDocument();
    expect(within(warm).queryAllByRole("article")).toEqual([]);
    const heading = within(warm).getByRole("heading", { level: 2, name: "Warm-up" });
    const note = within(warm).getByText("5 min rower");
    expect(heading.compareDocumentPosition(note) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy(); // heading → note
    expect(within(screen.getByRole("region", { name: "Main" })).getAllByRole("article")).toHaveLength(2);
    expect(within(screen.getByRole("region", { name: "Other exercises" })).getAllByRole("article")).toHaveLength(1);
    // the first loose card sits outside every region
    const facePull = screen.getByRole("article", { name: "Face pull" });
    expect(sectionRegions().some((r) => r.contains(facePull))).toBe(false);
    // sticky bar, banners and SyncStatus are untouched
    expect(screen.getByTestId("session-bar")).toBeInTheDocument();
  });

  it("brackets never cross a heading: the superset pair is one run inside Main", async () => {
    await setup(sectioned());
    const main = screen.getByRole("region", { name: "Main" });
    expect(Array.from(main.querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"))).toEqual(["first", "middle", "last"]);
  });

  it("a section's note is wrapped as text, in full (no clamp)", async () => {
    const long = "Pause every rep and breathe out. ".repeat(20).trim();
    await setup({ sections: [{ name: "Main", notes: long }], exercises: [ex("Bench", 0)] });
    expect(screen.getByText(long)).toBeInTheDocument();
  });

  it("a split section shows its note only under the first run", async () => {
    await setup({ sections: [{ name: "Main", notes: "Once only" }], exercises: [ex("A", 0), ex("B"), ex("C", 0)] });
    expect(regionNames()).toEqual(["Main", "Other exercises", "Main"]);
    expect(screen.getAllByText("Once only")).toHaveLength(1);
  });
});

describe("10.3 AC25 — the routine-note panel", () => {
  it("is expanded on mount, headed by the routine name; Hide collapses it to one Show line and Show re-expands it", async () => {
    const { user } = await setup(sectioned());
    const panel = screen.getByRole("region", { name: "Routine note · Push B" });
    expect(within(panel).getByText("Keep it short")).toBeInTheDocument();
    const hide = within(panel).getByRole("button", { name: "Hide routine note" });
    expect(hide).toHaveAttribute("aria-expanded", "true");
    await user.click(hide);
    expect(within(panel).queryByText("Keep it short")).toBeNull();
    const show = within(panel).getByRole("button", { name: "Show routine note" });
    expect(show).toHaveAttribute("aria-expanded", "false");
    await user.click(show);
    expect(within(panel).getByText("Keep it short")).toBeInTheDocument();
  });

  it("nothing is stored: the state is component-local, and a remount expands it again", async () => {
    const { user } = await setup(sectioned());
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const before = setItem.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Hide routine note" }));
    expect(setItem.mock.calls.length).toBe(before);
    cleanup();
    renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    expect(screen.getByText("Keep it short")).toBeInTheDocument();
    setItem.mockRestore();
  });

  it("a workout with routineNotes null shows no panel", async () => {
    await setup({ routineName: "Push B", exercises: [ex("A")] });
    expect(screen.queryByText(/Routine note/)).toBeNull();
  });
});
