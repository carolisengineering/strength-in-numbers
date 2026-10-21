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

import type { PlannedSet } from "@sin/core";
import { pinTimeZone } from "../../test/timeZone";
import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { finishButton } from "../../test/sessionHelpers";

pinTimeZone("Europe/London");
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true, now: new Date("2026-10-18T10:00:00Z") });
});
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  cleanupApp();
});

const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
/** One logged set; `plannedSets: 1` finishes from the bar, `2` leaves one unlogged (End workout early). */
const bench = (plannedSets: number): ExerciseSpec => ({ modality: "weight_reps", name: "Bench Press", plannedSets: planned(plannedSets), sets: [makeSet({ setNumber: 1 })] });

async function setup(plan: number | null, plannedSets = 1) {
  const active = makeWorkoutDetail({
    startedAt: "2026-10-16T17:00:00.000Z",
    localDate: "2026-10-16",
    tzOffsetMinutes: 60,
    plannedDurationSeconds: plan,
    exercises: [bench(plannedSets)],
  });
  const fake = createWorkoutFake({ active });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}

const finishDialog = () => within(screen.getByRole("dialog", { name: "Finish workout?" }));
const finishBodies = (fake: ReturnType<typeof createWorkoutFake>) =>
  fake.requests.filter((r) => r.method === "PATCH" && /^\/v1\/workouts\/[^/]+$/.test(r.path)).map((r) => r.body as { endedAt: string });

describe("18.0 AC37 — Finish with a plan", () => {
  it("ends at start + plan, and the dialog's duration is the plan", async () => {
    const { user, fake } = await setup(3600);
    await user.click(finishButton());
    expect(finishDialog().getByText("1 h")).toBeInTheDocument();
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(finishBodies(fake)).toHaveLength(1));
    expect(finishBodies(fake)).toEqual([{ endedAt: "2026-10-16T18:00:00.000Z" }]);
  });

  it("without a plan it ends now", async () => {
    const { user, fake } = await setup(null);
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(finishBodies(fake)).toHaveLength(1));
    expect(finishBodies(fake)[0]!.endedAt).toMatch(/^2026-10-18T10:00:0\d\.\d{3}Z$/);
  });
});

describe("18.0 AC38 — the dialogs say where it ends", () => {
  const ENDS = "Ends Fri 16 Oct, 19:00, as set in Change Time.";

  it("Finish workout? has the line after the stats; title and buttons are unchanged", async () => {
    const { user } = await setup(3600);
    await user.click(finishButton());
    const dialog = screen.getByRole("dialog", { name: "Finish workout?" });
    const ends = within(dialog).getByText(ENDS);
    expect(within(dialog).getByRole("list").compareDocumentPosition(ends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep logging" })).toBeInTheDocument();
  });

  it("End workout early? has it after the stats and before the planned-sets flag", async () => {
    const { user } = await setup(3600, 2);
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    const dialog = within(screen.getByRole("dialog", { name: "End workout early?" }));
    const ends = dialog.getByText(ENDS);
    const flag = dialog.getByText("1 planned set not logged");
    expect(dialog.getAllByRole("list")[0]!.compareDocumentPosition(ends) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(ends.compareDocumentPosition(flag) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("without a plan End workout early? has no line", async () => {
    const { user } = await setup(null, 2);
    await user.click(screen.getByRole("button", { name: "Workout menu" }));
    await user.click(screen.getByRole("button", { name: "End workout early" }));
    expect(within(screen.getByRole("dialog", { name: "End workout early?" })).queryByText(/^Ends /)).toBeNull();
  });

  it("without a plan Finish workout? has no line", async () => {
    const { user } = await setup(null);
    await user.click(finishButton());
    expect(finishDialog().queryByText(/^Ends /)).toBeNull();
  });
});

describe("18.0 AC43 — workout_finished gains hadPlannedDuration", () => {
  it.each([
    [3600, true],
    [null, false],
  ])("plan %s → %s", async (plan, expected) => {
    const { user } = await setup(plan);
    await user.click(finishButton());
    await user.click(finishDialog().getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ hadPlannedDuration: expected })));
  });
});
