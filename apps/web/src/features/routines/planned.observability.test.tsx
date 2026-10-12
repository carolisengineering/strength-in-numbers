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
const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { catalog, pushA } from "../../test/routineFixtures";
import { routineId } from "../../test/workoutFixtures";

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

describe("10.2 AC33 — planning a routine reports and tracks nothing", () => {
  it("plan each set, edit weights, Save: no track() call, no reportError, no planned value in any spy argument", async () => {
    const fake = createWorkoutFake({ catalog, routines: [pushA] });
    prepareApp({ auth, catalog, fake });
    const { router, user } = renderApp(`/app/workouts/routines/${routineId(1)}/edit`);
    await user.click(await screen.findByRole("button", { name: /^Overhead Press/ }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Plan each set" }));
    const weight = within(dialog).getByLabelText("Set 1 weight");
    await user.type(weight, "67.5");
    await user.click(within(dialog).getByRole("button", { name: "Add set" }));
    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe(`/app/workouts/routines/${routineId(1)}`));
    expect(observability.track).not.toHaveBeenCalled();
    expect(observability.reportError).not.toHaveBeenCalled();
    expect(JSON.stringify([observability.track.mock.calls, observability.reportError.mock.calls])).not.toContain("67.5");
  });
});
