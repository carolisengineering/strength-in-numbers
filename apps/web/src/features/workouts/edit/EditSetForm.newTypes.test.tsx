import { screen, within } from "@testing-library/react";
import { segmentChoice } from "../../../test/controls";
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
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
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

describe("17.8 AC16 — edit screen", () => {
  it("the set sheet and the add-set form use the steppers, named with the exercise", async () => {
    const { user } = open([{ modality: "duration", name: "Plank", sets: [makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, durationS: 45 })] }]);
    await ready();
    await user.click(within(card("Plank")).getByRole("button", { name: /0:45/ }));
    expect(sheet(/^Set 1 · Plank/).getByRole("button", { name: "+5 s, increase time for Plank" })).toBeInTheDocument();
    await user.click(sheet(/^Set 1 · Plank/).getByRole("button", { name: "Close" }));
    await user.click(addSetButton("Plank"));
    expect(sheet("New set · Plank").getByRole("button", { name: "\u22125 s, decrease time for Plank" })).toBeInTheDocument();
  });

  it("a server 422 on durationS shows under the duration's fields", async () => {
    const { fake, user } = open([{ modality: "duration", name: "Plank", sets: [makeSet({ reps: null, weight: null, weightUnit: null, weightKg: null, durationS: 45 })] }]);
    await ready();
    fake.failNext({ method: "PATCH", path: /\/sets\// }, () => problemResponse(422, "validation-error", { errors: [{ path: "durationS", message: "Too long" }] }));
    await user.click(within(card("Plank")).getByRole("button", { name: /0:45/ }));
    const s = sheet(/^Set 1 · Plank/);
    await user.click(s.getByRole("button", { name: "+5 s, increase time for Plank" }));
    await user.click(s.getByRole("button", { name: "Save" }));
    const message = await s.findByText("Too long");
    expect(message.closest("[data-stepper-row]")).not.toBeNull();
  });
});

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
    expect(segmentChoice("Distance unit", s)).toBe("ft");
  });
  it("hold: Weight + unit and Minutes / Seconds", async () => {
    const { user } = open([{ modality: "weight_duration", name: "Sandbag Hold", sets: [makeSet({ reps: null, weight: 20, durationS: 90 })] }]);
    await ready();
    await user.click(within(card("Sandbag Hold")).getByRole("button", { name: /20 kg · 1:30/ }));
    const s = sheet(/^Set 1 · Sandbag Hold/);
    expect(segmentChoice("Weight unit", s)).toBe("kg");
    expect(s.getByLabelText("Minutes")).toHaveValue("1");
    expect(s.getByLabelText("Seconds")).toHaveValue("30");
  });
  it("Add set on a carry with no sets seeds meters, even on a lb profile", async () => {
    const { user } = open([{ modality: "weight_distance", name: "Farmer Carry", sets: [] }], "lb");
    await ready();
    await user.click(addSetButton("Farmer Carry"));
    const s = sheet("New set · Farmer Carry");
    expect(segmentChoice("Distance unit", s)).toBe("m");
    expect(segmentChoice("Weight unit", s)).toBe("lb");
  });
});
