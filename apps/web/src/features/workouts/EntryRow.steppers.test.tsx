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
import { chooseSegment, segmented, segmentValue } from "../../test/controls";
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
    expect(panel().queryByRole("group", { name: "Set type" })).toBeNull();
    await openSetOptions(user, card("X"));
    expect(segmented("Set type", card("X"))).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "Increase weight by 2.5 kg" })).toBeInTheDocument();
    await chooseSegment(user, "Weight unit", "lb", card("X"));
    await user.click(panel().getByRole("button", { name: "Increase weight by 5 lb" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("65");
  });

  it("17.7 AC6 — Enter on a unit or type radio logs nothing", async () => {
    const { fake, user } = await setup([X({ sets: [lbSet] })]);
    await openSetOptions(user, card("X"));
    for (const [legend, option] of [["Weight unit", "lb"], ["Set type", "Working"]] as const) {
      const radio = within(segmented(legend, card("X"))).getByRole("radio", { name: option });
      act(() => radio.focus());
      const event = new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
      act(() => {
        radio.dispatchEvent(event);
      });
      expect(event.defaultPrevented).toBe(true);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fake.requests.filter((r) => r.method === "POST" && r.path.endsWith("/sets"))).toHaveLength(0);
  });

  it("a non-working planned set shows its type in the label and data-set-type on the panel", async () => {
    const warm: PlannedSet = { setType: "warmup", repsLow: 8, repsHigh: 8, weight: 45, weightUnit: "lb" };
    await setup([X({ plannedSets: [warm, { ...warm, setType: "working" }] })]);
    const form = panel().getByRole("form", { name: "Log a set of X" });
    expect(within(form).getByText("Set 1 of 2 · Warm-up")).toBeInTheDocument();
    expect(form).toHaveAttribute("data-set-type", "warmup");
  });
});

describe("17.7 AC9 — a unit change converts nothing", () => {
  it("lb profile, 100 typed, kg chosen: the weight still reads 100 and Log names kg", async () => {
    const { user } = await setup([X()], "lb");
    await user.type(panel().getByLabelText("Weight"), "100");
    await user.type(panel().getByLabelText("Reps"), "5");
    await openSetOptions(user, card("X"));
    await chooseSegment(user, "Weight unit", "kg", card("X"));
    expect(panel().getByLabelText("Weight")).toHaveValue("100");
    expect(segmentValue("Weight unit", card("X"))).toBe("kg");
    await waitFor(() => expect(logButton("X")).toHaveTextContent(/^Log 100 kg/));
  });

  it("a distance of 2 stays 2 when km becomes mi, and the draft stores mi", async () => {
    const { user } = await setup([X({ modality: "distance_duration" })], "kg");
    await user.type(panel().getByLabelText(/^Distance/), "2");
    await openSetOptions(user, card("X"));
    expect(segmentValue("Distance unit", card("X"))).toBe("km");
    await chooseSegment(user, "Distance unit", "mi", card("X"));
    expect(panel().getByLabelText(/^Distance/)).toHaveValue("2");
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(DRAFTS_KEY) ?? "{}").byExercise).toBeTruthy());
    const stored = JSON.parse(localStorageAdapter().get(DRAFTS_KEY)!);
    expect(Object.values(stored.byExercise as Record<string, { distance: string; distanceUnit: string }>)[0]).toMatchObject({ distance: "2", distanceUnit: "mi" });
  });
});
