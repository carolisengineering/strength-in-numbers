import type { PlannedSet } from "@sin/core";
import { act, screen, waitFor, within } from "@testing-library/react";
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

import { localStorageAdapter } from "../../storage/storage";
import { card, logButton, openSetOptions } from "../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { DRAFTS_KEY } from "./drafts/draftStore";

afterEach(() => {
  observability.track.mockReset();
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[], unitPreference: "kg" | "lb" = "lb") {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake, unitPreference });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const X = (o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name: "X", ...o });
const lbSet = makeSet({ setNumber: 1, weight: 185, weightUnit: "lb", weightKg: 83.915, reps: 5 });
const panel = () => within(card("X"));

describe("17.1 AC18 — the weight stepper", () => {
  it("steps 5 lb by the draft's unit and writes the formatted value", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    await user.click(panel().getByRole("button", { name: "Increase weight by 5 lb" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("190");
    await user.click(panel().getByRole("button", { name: "Decrease weight by 5 lb" }));
    await user.click(panel().getByRole("button", { name: "Decrease weight by 5 lb" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("180");
  });

  it("disables − at 0 (blank counts as 0) and + at SET_WEIGHT_MAX", async () => {
    const { user } = await setup([X()]);
    expect(panel().getByRole("button", { name: "Decrease weight by 5 lb" })).toBeDisabled();
    await user.type(panel().getByLabelText("Weight"), "9999.999");
    expect(panel().getByRole("button", { name: "Increase weight by 5 lb" })).toBeDisabled();
  });

  it("weighted bodyweight labels it Added weight and has both steppers", async () => {
    await setup([X({ modality: "weighted_bodyweight" })]);
    expect(panel().getByLabelText("Added weight")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Increase reps" })).toBeInTheDocument();
    expect(panel().getByRole("group", { name: "Added weight · lb" })).toBeInTheDocument();
  });
});

describe("17.1 AC19 — the reps stepper", () => {
  it("steps by one from blank and floors at 0", async () => {
    const { user } = await setup([X()]);
    await user.click(panel().getByRole("button", { name: "Increase reps" }));
    expect(panel().getByLabelText("Reps")).toHaveValue("1");
    await user.click(panel().getByRole("button", { name: "Decrease reps" }));
    expect(panel().getByLabelText("Reps")).toHaveValue("0");
    expect(panel().getByRole("button", { name: "Decrease reps" })).toBeDisabled();
  });
});

describe("17.1 AC20 — the number is still an input", () => {
  it("is a text input with the right keyboard; focus selects its text; the static messages still show", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    const weight = panel().getByLabelText("Weight") as HTMLInputElement;
    expect(weight).toHaveAttribute("type", "text");
    expect(weight).toHaveAttribute("inputmode", "decimal");
    expect(weight).toHaveAttribute("autocomplete", "off");
    expect(panel().getByLabelText("Reps")).toHaveAttribute("inputmode", "numeric");
    act(() => weight.focus());
    expect([weight.selectionStart, weight.selectionEnd]).toEqual([0, 3]);
    await user.clear(weight);
    await user.type(weight, "abc");
    await user.tab();
    expect(panel().getByText("Enter a number")).toBeInTheDocument();
  });
});

describe("17.1 AC21 — a stepper tap is an edit", () => {
  it("persists the draft (06.5 AC6) and is never overwritten by a count change (10.2 AC25)", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    await user.click(panel().getByRole("button", { name: "Increase reps" }));
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(DRAFTS_KEY) ?? "{}").byExercise).toBeTruthy());
    const stored = JSON.parse(localStorageAdapter().get(DRAFTS_KEY)!);
    expect(Object.values(stored.byExercise as Record<string, { reps: string }>)[0]!.reps).toBe("6");
  });

  it("set_logged reports edited: true after a stepper tap (the log button is the card's until Task 10, then the bar's)", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    await user.click(panel().getByRole("button", { name: "Increase reps" }));
    await user.click(logButton("X"));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: true })));
  });
});

describe("17.1 AC22 — other modalities", () => {
  it.each([
    ["bodyweight_reps", ["Increase reps"], ["Increase weight by 5 lb"], []],
    ["duration", [], ["Increase reps", "Increase weight by 5 lb"], ["Minutes", "Seconds"]],
    ["distance_duration", [], ["Increase reps", "Increase weight by 5 lb"], ["Distance", "Minutes", "Seconds"]],
  ] as const)("%s", async (modality, shown, hidden, fields) => {
    await setup([X({ modality })]);
    for (const name of shown) expect(panel().getByRole("button", { name })).toBeInTheDocument();
    for (const name of hidden) expect(panel().queryByRole("button", { name })).toBeNull();
    for (const label of fields) expect(panel().getByLabelText(label)).toBeInTheDocument();
  });
});

describe("17.1 AC23 — set type and unit stay reachable", () => {
  it("Set options holds Set type and the unit; a unit change re-steps by the new unit", async () => {
    const { user } = await setup([X({ sets: [makeSet({ setNumber: 1, weight: 60, weightUnit: "kg", reps: 8 })] })]);
    expect(panel().queryByLabelText("Set type")).toBeNull();
    await openSetOptions(user, card("X"));
    expect(panel().getByLabelText("Set type")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Increase weight by 2.5 kg" })).toBeInTheDocument();
    await user.selectOptions(panel().getByLabelText("Weight unit"), "lb");
    await user.click(panel().getByRole("button", { name: "Increase weight by 5 lb" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("65");
  });

  it("a non-working planned set shows its type in the label and data-set-type on the panel", async () => {
    const warm: PlannedSet = { setType: "warmup", repsLow: 8, repsHigh: 8, weight: 45, weightUnit: "lb" };
    await setup([X({ plannedSets: [warm, { ...warm, setType: "working" }] })]);
    const form = panel().getByRole("form", { name: "Log a set of X" });
    expect(within(form).getByText("Set 1 of 2 · Warm-up")).toBeInTheDocument();
    expect(form).toHaveAttribute("data-set-type", "warmup");
  });
});
