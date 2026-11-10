import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

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
    await user.click(panel().getByRole("button", { name: "+5 lb, increase weight for X" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("190");
    await user.click(panel().getByRole("button", { name: "\u22125 lb, decrease weight for X" }));
    await user.click(panel().getByRole("button", { name: "\u22125 lb, decrease weight for X" }));
    expect(panel().getByLabelText("Weight")).toHaveValue("180");
  });

  it("disables − at 0 (blank counts as 0) and + at SET_WEIGHT_MAX", async () => {
    const { user } = await setup([X()]);
    expect(panel().getByRole("button", { name: "\u22125 lb, decrease weight for X" })).toBeDisabled();
    await user.type(panel().getByLabelText("Weight"), "9999.999");
    expect(panel().getByRole("button", { name: "+5 lb, increase weight for X" })).toBeDisabled();
  });

  it("weighted bodyweight labels it Added weight and has both steppers", async () => {
    await setup([X({ modality: "weighted_bodyweight" })]);
    expect(panel().getByLabelText("Added weight")).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "+1, increase reps for X" })).toBeInTheDocument();
    expect(panel().getByRole("group", { name: "Added weight · lb" })).toBeInTheDocument();
  });
});

describe("17.1 AC19 — the reps stepper", () => {
  it("steps by one from blank and floors at 0", async () => {
    const { user } = await setup([X()]);
    await user.click(panel().getByRole("button", { name: "+1, increase reps for X" }));
    expect(panel().getByLabelText("Reps")).toHaveValue("1");
    await user.click(panel().getByRole("button", { name: "\u22121, decrease reps for X" }));
    expect(panel().getByLabelText("Reps")).toHaveValue("0");
    expect(panel().getByRole("button", { name: "\u22121, decrease reps for X" })).toBeDisabled();
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
    await user.click(panel().getByRole("button", { name: "+1, increase reps for X" }));
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(DRAFTS_KEY) ?? "{}").byExercise).toBeTruthy());
    const stored = JSON.parse(localStorageAdapter().get(DRAFTS_KEY)!);
    expect(Object.values(stored.byExercise as Record<string, { reps: string }>)[0]!.reps).toBe("6");
  });

  it("set_logged reports edited: true after a stepper tap (the log button is the card's until Task 10, then the bar's)", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    await user.click(panel().getByRole("button", { name: "+1, increase reps for X" }));
    await user.click(logButton("X"));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: true })));
  });
});

describe("17.1 AC22 — other modalities", () => {
  it.each([
    ["bodyweight_reps", ["+1, increase reps for X"], ["+5 lb, increase weight for X"], []],
    ["duration", [], ["+1, increase reps for X", "+5 lb, increase weight for X"], ["Minutes", "Seconds"]],
    ["distance_duration", [], ["+1, increase reps for X", "+5 lb, increase weight for X"], ["Distance", "Minutes", "Seconds"]],
  ] as const)("%s", async (modality, shown, hidden, fields) => {
    await setup([X({ modality })]);
    for (const name of shown) expect(panel().getByRole("button", { name })).toBeInTheDocument();
    for (const name of hidden) expect(panel().queryByRole("button", { name })).toBeNull();
    for (const label of fields) expect(panel().getByLabelText(label)).toBeInTheDocument();
  });
});

describe("17.1 AC23 — set type and unit stay reachable", () => {
  it("More holds Set type and the unit; a unit change re-steps by the new unit", async () => {
    const { user } = await setup([X({ sets: [makeSet({ setNumber: 1, weight: 60, weightUnit: "kg", reps: 8 })] })]);
    expect(panel().queryByRole("group", { name: "Set type" })).toBeNull();
    await openSetOptions(user, card("X"));
    expect(segmented("Set type", card("X"))).toBeInTheDocument();
    expect(panel().getByRole("button", { name: "+2.5 kg, increase weight for X" })).toBeInTheDocument();
    await chooseSegment(user, "Weight unit", "lb", card("X"));
    await user.click(panel().getByRole("button", { name: "+5 lb, increase weight for X" }));
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

describe("17.8 AC3 — the buttons show their step", () => {
  const stepButtons = (scope: HTMLElement) => within(scope).getAllByRole("button").filter((b) => b.closest("[data-stepper-row]") !== null);

  it("lb weight shows −5 / +5, reps −1 / +1, and no step button holds an icon", async () => {
    await setup([X({ sets: [lbSet] })]);
    expect(stepButtons(card("X")).map((b) => b.textContent)).toEqual(["−5", "+5", "−1", "+1"]);
    for (const button of stepButtons(card("X"))) expect(button.querySelector("svg")).toBeNull();
  });

  it("kg weight shows −2.5 / +2.5", async () => {
    await setup([X({ sets: [makeSet({ setNumber: 1, weight: 60, weightUnit: "kg", reps: 8 })] })], "kg");
    expect(stepButtons(card("X")).slice(0, 2).map((b) => b.textContent)).toEqual(["−2.5", "+2.5"]);
  });

  it("calories show −5 / +5", async () => {
    await setup([X({ modality: "calories" })]);
    expect(stepButtons(card("X")).map((b) => b.textContent)).toEqual(["−5", "+5"]);
  });
});

describe("17.8 AC4 — names", () => {
  it("weight and reps name their step and the exercise", async () => {
    await setup([X({ name: "Overhead Press", sets: [lbSet] })]);
    const press = within(card("Overhead Press"));
    expect(press.getByRole("button", { name: "−5 lb, decrease weight for Overhead Press" })).toHaveTextContent(/^−5$/);
    expect(press.getByRole("button", { name: "+5 lb, increase weight for Overhead Press" })).toBeInTheDocument();
    expect(press.getByRole("button", { name: "+1, increase reps for Overhead Press" })).toHaveTextContent(/^\+1$/);
    expect(press.getByRole("button", { name: "−1, decrease reps for Overhead Press" })).toBeInTheDocument();
  });

  it("calories name their step and the exercise", async () => {
    await setup([X({ name: "Echo Bike", modality: "calories" })]);
    expect(within(card("Echo Bike")).getByRole("button", { name: "−5, decrease calories for Echo Bike" })).toBeInTheDocument();
    expect(within(card("Echo Bike")).getByRole("button", { name: "+5, increase calories for Echo Bike" })).toBeInTheDocument();
  });

  it("a unit change in More renames the button by the new step", async () => {
    const { user } = await setup([X({ sets: [lbSet] })]);
    await openSetOptions(user, card("X"));
    await chooseSegment(user, "Weight unit", "kg", card("X"));
    expect(panel().getByRole("button", { name: "+2.5 kg, increase weight for X" })).toHaveTextContent(/^\+2\.5$/);
  });

  it("a weighted bodyweight's button still says weight, though its label is Added weight", async () => {
    await setup([X({ modality: "weighted_bodyweight" })]);
    expect(panel().getByRole("button", { name: "+5 lb, increase weight for X" })).toBeInTheDocument();
  });
});

describe("17.8 AC11 — duration steppers", () => {
  const plank = () => within(card("Plank"));

  it("a Plank's panel has −5 s / +5 s with the exercise in their names; − is disabled when blank", async () => {
    await setup([X({ name: "Plank", modality: "duration" })]);
    expect(plank().getByRole("button", { name: "\u22125 s, decrease time for Plank" })).toHaveTextContent(/^\u22125 s$/);
    expect(plank().getByRole("button", { name: "+5 s, increase time for Plank" })).toHaveTextContent(/^\+5 s$/);
    expect(plank().getByRole("button", { name: "\u22125 s, decrease time for Plank" })).toBeDisabled();
  });

  it("+ from blank writes 0 and 5; 0:59 + 5 s writes 1 and 4 and the bar reads Log 1:04", async () => {
    const { user } = await setup([X({ name: "Plank", modality: "duration" })]);
    await user.click(plank().getByRole("button", { name: "+5 s, increase time for Plank" }));
    expect(plank().getByLabelText("Minutes")).toHaveValue("0");
    expect(plank().getByLabelText("Seconds")).toHaveValue("5");
    await user.clear(plank().getByLabelText("Seconds"));
    await user.type(plank().getByLabelText("Seconds"), "59");
    await user.click(plank().getByRole("button", { name: "+5 s, increase time for Plank" }));
    expect(plank().getByLabelText("Minutes")).toHaveValue("1");
    expect(plank().getByLabelText("Seconds")).toHaveValue("4");
    await waitFor(() => expect(logButton("Plank")).toHaveTextContent(/^Log 1:04/));
  });

  it("a step is an edit: set_logged reports edited: true", async () => {
    const { user } = await setup([X({ name: "Plank", modality: "duration" })]);
    await user.click(plank().getByRole("button", { name: "+5 s, increase time for Plank" }));
    await user.click(logButton("Plank"));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: true })));
  });
});

describe("17.8 AC10 — the rest slot is always there", () => {
  it("the slot is mounted with no timer and with one, so a rest starting never changes the label row", async () => {
    // A rest starts only while a planned set remains (17.1 D8), so the exercise has a plan.
    const working: PlannedSet = { setType: "working", repsLow: 5, repsHigh: 5, weight: 185, weightUnit: "lb" };
    const { user } = await setup([X({ restSeconds: 120, plannedSets: [working, working, working] })]);
    const slot = () => card("X").querySelector("[data-rest-slot]");
    expect(slot()).not.toBeNull();
    expect(within(card("X")).queryByRole("timer")).toBeNull();
    await user.click(logButton("X"));
    await within(card("X")).findByRole("timer");
    expect(within(slot() as HTMLElement).getByRole("timer")).toBeInTheDocument();
  });

  it("the slot reserves the figure's width and line height", () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "EntryRow.module.css"), "utf8");
    const rule = css.slice(css.indexOf(".restSlot {"), css.indexOf("}", css.indexOf(".restSlot {")));
    expect(rule).toMatch(/min-width:\s*var\(--rest-slot-width\)/);
    expect(rule).toMatch(/min-height:\s*calc\(var\(--font-size-figure\) \* var\(--line-height\)\)/);
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
    await user.type(panel().getByLabelText("Distance"), "2");
    await openSetOptions(user, card("X"));
    expect(segmentValue("Distance unit", card("X"))).toBe("km");
    await chooseSegment(user, "Distance unit", "mi", card("X"));
    expect(panel().getByLabelText("Distance")).toHaveValue("2");
    await waitFor(() => expect(JSON.parse(localStorageAdapter().get(DRAFTS_KEY) ?? "{}").byExercise).toBeTruthy());
    const stored = JSON.parse(localStorageAdapter().get(DRAFTS_KEY)!);
    expect(Object.values(stored.byExercise as Record<string, { distance: string; distanceUnit: string }>)[0]).toMatchObject({ distance: "2", distanceUnit: "mi" });
  });
});
