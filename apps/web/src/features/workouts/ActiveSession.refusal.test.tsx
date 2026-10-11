import { screen } from "@testing-library/react";
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
// A refused plan cannot be reached through an enabled toggle without a 99-exercise workout (the real-data
// case is covered in useRegroup.test.tsx); stub the planner so this file tests only the screen's response.
const planner = vi.hoisted(() => ({ refusal: { ok: false, reason: "no-free-group" } as unknown }));
vi.mock("@sin/core", async (original) => ({ ...(await original<typeof import("@sin/core")>()), planSessionChange: () => planner.refusal }));

import { LINK_CAP_MESSAGE } from "@sin/core";
import { makeWorkoutDetail } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";

afterEach(() => cleanupApp());

async function setup() {
  const fake = createWorkoutFake({
    active: makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "A" }, { modality: "weight_reps", name: "B" }] }),
  });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

describe("10.1 AC15 — a refused plan is a warning, with no request", () => {
  it.each([
    [{ ok: false, reason: "no-free-group" }, "This workout has too many supersets"],
    [{ ok: false, reason: "cap", message: LINK_CAP_MESSAGE }, LINK_CAP_MESSAGE],
  ])("%o → the banner says so and nothing is sent", async (refusal, text) => {
    planner.refusal = refusal;
    const { fake, user } = await setup();
    await user.click(screen.getByRole("button", { name: "Superset A with B" }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(fake.requests.filter((r) => r.method === "PATCH")).toEqual([]);
  });
});
