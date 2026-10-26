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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../../test/workoutFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { addSetButton, card } from "../../../test/sessionHelpers";

afterEach(() => cleanupApp());

function open(exercises: ExerciseSpec[], unitPreference: "kg" | "lb" = "kg") {
  const filler: ExerciseSpec = { modality: "weight_reps", name: "Bench Press", sets: [makeSet({ setNumber: 1 })] };
  const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", exercises: [...exercises, filler] });
  const fake = createWorkoutFake({ finished: [workout] });
  prepareApp({ auth, fake, unitPreference });
  return { fake, ...renderApp(`/app/history/${workout.id}/edit`) };
}
const ready = () => screen.findByRole("heading", { level: 1, name: "Edit workout" });
const sheet = (name: RegExp | string) => within(screen.getByRole("dialog", { name }));

describe("18.1 AC20 — the edit screen's set sheet", () => {
  it("calories: a Calories field prefilled", async () => {
    const { user } = open([{ modality: "calories", name: "Echo Bike", sets: [makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, calories: 20 })] }]);
    await ready();
    await user.click(within(card("Echo Bike")).getByRole("button", { name: /20 cal/ }));
    expect(sheet(/^Set 1 · Echo Bike/).getByLabelText("Calories")).toHaveValue("20");
  });
  it("carry: Weight + unit and Distance + unit, prefilled with its own unit (ft)", async () => {
    const { user } = open([{ modality: "weight_distance", name: "Farmer Carry", sets: [makeSet({ reps: null, weight: 24, distance: 100, distanceUnit: "ft", distanceM: 30.48 })] }]);
    await ready();
    await user.click(within(card("Farmer Carry")).getByRole("button", { name: /24 kg · 100 ft/ }));
    const s = sheet(/^Set 1 · Farmer Carry/);
    expect(s.getByLabelText("Weight")).toHaveValue("24");
    expect(s.getByLabelText("Distance")).toHaveValue("100");
    expect(s.getByLabelText("Distance unit")).toHaveValue("ft");
  });
  it("hold: Weight + unit and Minutes / Seconds", async () => {
    const { user } = open([{ modality: "weight_duration", name: "Sandbag Hold", sets: [makeSet({ reps: null, weight: 20, durationS: 90 })] }]);
    await ready();
    await user.click(within(card("Sandbag Hold")).getByRole("button", { name: /20 kg · 1:30/ }));
    const s = sheet(/^Set 1 · Sandbag Hold/);
    expect(s.getByLabelText("Weight unit")).toHaveValue("kg");
    expect(s.getByLabelText("Minutes")).toHaveValue("1");
    expect(s.getByLabelText("Seconds")).toHaveValue("30");
  });
  it("Add set on a carry with no sets seeds meters, even on a lb profile", async () => {
    const { user } = open([{ modality: "weight_distance", name: "Farmer Carry", sets: [] }], "lb");
    await ready();
    await user.click(addSetButton("Farmer Carry"));
    const s = sheet("New set · Farmer Carry");
    expect(s.getByLabelText("Distance unit")).toHaveValue("m");
    expect(s.getByLabelText("Weight unit")).toHaveValue("lb");
  });
});
