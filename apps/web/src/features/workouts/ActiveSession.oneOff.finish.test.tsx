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

import { catalog } from "../../test/routineFixtures";
import { finishButton } from "../../test/sessionHelpers";
import { makeRoutine, makeRoutineItem, makeSet, makeWorkoutDetail, routineId } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { ONE_OFF_TAG } from "../routines/messages";
import { KEEP_IN_ROUTINES } from "./messages";

const cls = makeRoutine({ id: routineId(5), name: "Class Fri 16 Oct", oneOffUntil: "2099-10-30T12:00:00.000Z", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
const pushA = makeRoutine({ id: routineId(6), name: "Push A", items: [makeRoutineItem({ exerciseId: catalog[0]!.id })] });
const WORKOUT_PATCH = /^\/v1\/workouts\/[^/]+$/;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => cleanupApp());

async function setup() {
  const active = makeWorkoutDetail({ routineName: cls.name, routineIsOneOff: true, exercises: [{ modality: "weight_reps", name: "Bench Press", sets: [makeSet()] }] });
  const fake = createWorkoutFake({ catalog, routines: [cls, pushA], active, activeRoutineId: cls.id });
  prepareApp({ auth, catalog, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, active, ...app };
}
const dialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const listReadsAfter = (fake: ReturnType<typeof createWorkoutFake>, index: number) =>
  fake.requests.slice(index + 1).filter((r) => r.method === "GET" && r.path === "/v1/routines").length;
const lastPatch = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.findLastIndex((r) => r.method === "PATCH" && WORKOUT_PATCH.test(r.path));
type App = Awaited<ReturnType<typeof setup>>;

async function toWorkouts({ user }: App) {
  await user.click(await screen.findByRole("link", { name: "Back to Workouts" }));
  return screen.findByRole("list", { name: "Routines" });
}

describe("10.5 AC15 — after the finish the routines list shows the truth", () => {
  it("unchecked: the routines list is refetched after the PATCH and the one-off is gone", async () => {
    const app = await setup();
    await app.queryClient.prefetchQuery({ queryKey: ["routines", "list"], queryFn: async () => [cls, pushA] });
    await app.user.click(finishButton());
    await app.user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(app.queryClient.getQueryState(["routines", "list"])?.isInvalidated).toBe(true);
    const list = await toWorkouts(app);
    await waitFor(() => expect(listReadsAfter(app.fake, lastPatch(app.fake))).toBeGreaterThan(0));
    await waitFor(() => expect(within(list).queryByRole("link", { name: /Class Fri 16 Oct/ })).toBeNull());
  });

  it("checked: the routine is listed, no longer tagged", async () => {
    const app = await setup();
    await app.user.click(finishButton());
    await app.user.click(within(dialog()).getByRole("checkbox", { name: KEEP_IN_ROUTINES }));
    await app.user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    const list = await toWorkouts(app);
    const row = await within(list).findByRole("link", { name: /Class Fri 16 Oct/ });
    await waitFor(() => expect(within(row).queryByText(ONE_OFF_TAG)).toBeNull());
  });

  it("the 409 recovery (a lost response) refreshes the list too", async () => {
    const app = await setup();
    // Warm the routines cache, as a lifter who looked at Workouts earlier would have.
    await app.queryClient.prefetchQuery({ queryKey: ["routines", "list"], queryFn: async () => [cls, pushA] });
    app.fake.loseNextResponse({ method: "PATCH", path: WORKOUT_PATCH });
    await app.user.click(finishButton());
    await app.user.click(within(dialog()).getByRole("button", { name: "Finish" }));
    await app.user.click(await screen.findByRole("button", { name: "Try again" }));
    await screen.findByRole("heading", { level: 1, name: "Workout summary" });
    expect(app.queryClient.getQueryState(["routines", "list"])?.isInvalidated).toBe(true);
    const list = await toWorkouts(app);
    await waitFor(() => expect(within(list).queryByRole("link", { name: /Class Fri 16 Oct/ })).toBeNull());
  });
});
