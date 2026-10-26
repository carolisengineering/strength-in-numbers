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

import type { Modality } from "@sin/core";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

const CAL = { reps: null, weight: null, weightUnit: null, weightKg: null, calories: 20 };
const CARRY = (unit: "m" | "km" | "ft", distance: number, distanceM: number) => ({ reps: null, weight: 24, distance, distanceUnit: unit, distanceM });
const HOLD = { reps: null, weight: 20, durationS: 90 };

async function setup(modality: Modality, set: Record<string, unknown>) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises: [{ modality, name: "X", sets: [makeSet({ setNumber: 1, ...set })] }] }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const card = () => screen.getByRole("article", { name: "X" });
const dialog = () => within(screen.getByRole("dialog", { name: /^Set 1 · X$/ }));

describe("18.1 AC20 — the live set sheet", () => {
  it("a calories set opens with Calories prefilled; a change sends { calories }", async () => {
    const { fake, user } = await setup("calories", CAL);
    await user.click(within(card()).getByRole("button", { name: /20 cal/ }));
    expect(dialog().getByLabelText("Calories")).toHaveValue("20");
    expect(dialog().queryByLabelText("Weight")).toBeNull();
    await user.clear(dialog().getByLabelText("Calories"));
    await user.type(dialog().getByLabelText("Calories"), "25");
    await user.click(dialog().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fake.requests.filter((r) => r.method === "PATCH").map((r) => r.body)).toEqual([{ calories: 25 }]));
  });
  it("a carry opens with Weight + unit and Distance + unit prefilled", async () => {
    const { user } = await setup("weight_distance", CARRY("m", 40, 40));
    await user.click(within(card()).getByRole("button", { name: /24 kg · 40 m/ }));
    expect(dialog().getByLabelText("Weight")).toHaveValue("24");
    expect(dialog().getByLabelText("Weight unit")).toHaveValue("kg");
    expect(dialog().getByLabelText("Distance")).toHaveValue("40");
    expect(dialog().getByLabelText("Distance unit")).toHaveValue("m");
    expect(dialog().queryByLabelText("Reps")).toBeNull();
  });
  it.each([
    ["km", 0.4, 400],
    ["ft", 100, 30.48],
  ] as const)("Review Focus 3 — a carry stored in %s opens with %s selected, not the m default", async (unit, distance, distanceM) => {
    const { user } = await setup("weight_distance", CARRY(unit, distance, distanceM));
    await user.click(within(card()).getByRole("button", { name: new RegExp(`24 kg · ${distance} ${unit}`) }));
    expect(dialog().getByLabelText("Distance unit")).toHaveValue(unit);
  });
  it("a hold opens with Weight + unit and Minutes / Seconds prefilled", async () => {
    const { user } = await setup("weight_duration", HOLD);
    await user.click(within(card()).getByRole("button", { name: /20 kg · 1:30/ }));
    expect(dialog().getByLabelText("Weight")).toHaveValue("20");
    expect(dialog().getByLabelText("Minutes")).toHaveValue("1");
    expect(dialog().getByLabelText("Seconds")).toHaveValue("30");
    expect(dialog().queryByLabelText("Reps")).toBeNull();
  });
});
