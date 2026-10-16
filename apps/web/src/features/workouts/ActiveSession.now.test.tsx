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

import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { card, makeCurrent, optionsButton } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const planned = (n: number, weight = 100, reps = 5): PlannedSet[] =>
  Array.from({ length: n }, () => ({ setType: "working", repsLow: reps, repsHigh: reps, weight, weightUnit: "kg" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }), catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("17.1 AC9 — one expanded, the rest collapsed", () => {
  it("only the current exercise mounts the full card; a collapsed row is one heading button", async () => {
    await setup([ex("A"), ex("B"), ex("C")]);
    expect(within(card("A")).getByRole("form", { name: "Log a set of A" })).toBeInTheDocument();
    for (const name of ["B", "C"]) {
      const row = card(name);
      const buttons = within(row).getAllByRole("button");
      expect(buttons).toHaveLength(1);
      expect(within(row).getByRole("heading", { level: 2 })).toContainElement(buttons[0]!);
      expect(buttons[0]).toHaveAttribute("aria-expanded", "false");
      expect(row.querySelector("form, dialog")).toBeNull();
    }
  });
});

describe("17.1 AC10 — collapsed rows render the summary and a drawn check", () => {
  it("done shows an aria-hidden SVG check, never a glyph; the name is in words", async () => {
    await setup([
      ex("Bench Press", { plannedSets: planned(3), sets: [1, 2, 3].map((n) => makeSet({ setNumber: n })) }),
      ex("Overhead Press", { plannedSets: planned(2, 50, 6) }),
      ex("Curl"),
    ]);
    const done = within(card("Bench Press")).getByRole("button", { name: "Bench Press, 3 sets logged" });
    expect(done).toHaveTextContent(/^Bench Press · 3 sets$/);
    expect(done.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    expect(done.textContent).not.toMatch(/✓/);
    expect(within(card("Curl")).getByRole("button")).toHaveTextContent("Curl · no sets yet");
    expect(within(card("Curl")).getByRole("button").querySelector("svg")).toBeNull();
  });
});

describe("17.1 AC11 — tap to make current", () => {
  it("expands the tapped row, collapses the previous one and focuses the new heading", async () => {
    const { user } = await setup([ex("A"), ex("B")]);
    await user.click(within(card("B")).getByRole("button", { expanded: false }));
    expect(within(card("B")).getByRole("form", { name: "Log a set of B" })).toBeInTheDocument();
    expect(within(card("A")).queryByRole("form")).toBeNull();
    expect(within(card("B")).getByRole("heading", { level: 2, name: "B" })).toHaveFocus();
  });

  it("an edited draft survives collapsing; an untouched one is re-seeded", async () => {
    const { user } = await setup([ex("A", { sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })] }), ex("B")]);
    const weight = within(card("A")).getByLabelText("Weight");
    await user.clear(weight);
    await user.type(weight, "62.5");
    await makeCurrent(user, "B");
    await makeCurrent(user, "A");
    expect(within(card("A")).getByLabelText("Weight")).toHaveValue("62.5");
    await makeCurrent(user, "B");
    expect(within(card("B")).getByLabelText("Weight")).toHaveValue("");
  });
});

describe("17.1 AC13 — adding and removing", () => {
  it("a newly added exercise becomes current once it appears", async () => {
    const { user } = await setup([ex("A")]);
    await user.click(screen.getByRole("button", { name: "Add exercise" }));
    const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
    await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Bench Press/ }));
    await waitFor(() => expect(within(card("Bench Press")).getByRole("form", { name: "Log a set of Bench Press" })).toBeInTheDocument());
    expect(within(card("A")).queryByRole("form")).toBeNull();
  });

  it("removing the current exercise re-derives current", async () => {
    const { user } = await setup([ex("A"), ex("B")]);
    await user.click(optionsButton("A"));
    await user.click(within(card("A")).getByRole("button", { name: "Remove exercise" }));
    await waitFor(() => expect(screen.queryByRole("article", { name: "A" })).not.toBeInTheDocument());
    expect(within(card("B")).getByRole("form", { name: "Log a set of B" })).toBeInTheDocument();
  });
});

describe("17.1 AC16 — brackets, sections and link toggles", () => {
  it("collapsed rows keep the bracket; a toggle shows only beside the current card", async () => {
    const { user } = await setup([ex("A", { supersetGroup: 1 }), ex("B", { supersetGroup: 1 }), ex("C")]);
    expect(screen.getByRole("button", { name: "Superset A with B" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Superset B with C" })).not.toBeInTheDocument();
    expect(card(/^B,/).closest("[class*='grouped']")).not.toBeNull(); // a run's card is named by its label ("B, superset 1")
    await makeCurrent(user, /^B,/);
    expect(screen.getByRole("button", { name: "Superset A with B" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Superset B with C" })).toBeInTheDocument();
  });

  it("collapsed rows sit under their section headings", async () => {
    const fake = createWorkoutFake({
      active: makeWorkoutDetail({ sections: [{ name: "Main" }, { name: "Accessories" }], exercises: [ex("A", { sectionIndex: 0 }), ex("B", { sectionIndex: 1 })] }),
    });
    prepareApp({ auth, fake });
    renderApp("/app/workouts");
    const section = await screen.findByRole("region", { name: "Accessories" });
    expect(within(section).getByRole("article", { name: "B" })).toBeInTheDocument();
  });
});
