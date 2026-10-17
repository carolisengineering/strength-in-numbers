import type { PlannedSet } from "@sin/core";
import { render, screen, waitFor, within } from "@testing-library/react";
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

import { makeSet, makeWorkoutDetail, type ExerciseSpec } from "../../test/workoutFixtures";
import { createWorkoutFake } from "../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../test/workoutHarness";
import { finishButton } from "../../test/sessionHelpers";
import { FinishDialogBody } from "./FinishDialog";

const START = Date.parse("2026-10-02T10:00:00.000Z"); // the fixtures' startedAt
const planned = (n: number): PlannedSet[] => Array.from({ length: n }, () => ({ setType: "working", repsLow: 5, repsHigh: 5, weight: 100, weightUnit: "kg" }));
const working = (n: number, from = 1) => Array.from({ length: n }, (_, i) => makeSet({ setNumber: from + i }));
const warmups = (n: number, from = 1) => Array.from({ length: n }, (_, i) => makeSet({ setNumber: from + i, setType: "warmup" }));
const ex = (name: string, o: Partial<ExerciseSpec> = {}): ExerciseSpec => ({ modality: "weight_reps", name, ...o });

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(START + 41 * 60_000);
});
afterEach(() => {
  vi.useRealTimers();
  observability.track.mockReset();
  cleanupApp();
});

async function setup(exercises: ExerciseSpec[]) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail({ exercises }) });
  prepareApp({ auth, fake });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
const finishDialog = () => screen.getByRole("dialog", { name: "Finish workout?" });
const endEarlyDialog = () => screen.getByRole("dialog", { name: "End workout early?" });
const statTexts = (dialog: HTMLElement) => within(dialog).getAllByRole("listitem").slice(0, 3).map((li) => li.textContent);
const openEndEarly = async (user: Awaited<ReturnType<typeof setup>>["user"]) => {
  await user.click(screen.getByRole("button", { name: "Workout menu" }));
  await user.click(screen.getByRole("button", { name: "End workout early" }));
};
const patches = (fake: ReturnType<typeof createWorkoutFake>) => fake.requests.filter((r) => r.method === "PATCH" && /\/v1\/workouts\/[^/]+$/.test(r.path));

describe("17.2 AC1 / AC4 — the Finish dialog leads with what you did", () => {
  it("shows duration, exercises and sets, then the can't-be-edited sentence; labels unchanged", async () => {
    const { user } = await setup([ex("A", { sets: working(2) }), ex("B", { sets: working(2) })]);
    await user.click(finishButton());
    const dialog = finishDialog();
    expect(statTexts(dialog)).toEqual(["41 minduration", "2exercises", "4sets"]);
    const text = dialog.textContent ?? "";
    expect(text.indexOf("sets")).toBeLessThan(text.indexOf("A finished workout can't be edited."));
    expect(text).not.toMatch(/exercises? · \d+ sets?/);
    expect(within(dialog).getByRole("button", { name: "Finish" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep logging" })).toBeInTheDocument();
    expect(within(dialog).queryByText("planned sets not logged")).toBeNull();
  });

  it("uses singular nouns' stats without a volume row", async () => {
    const { user } = await setup([ex("A", { sets: working(1) })]);
    await user.click(finishButton());
    expect(within(finishDialog()).queryByText("volume")).toBeNull();
    expect(statTexts(finishDialog())).toEqual(["41 minduration", "1exercises", "1sets"]);
  });
});

describe("17.2 AC2 — End workout early: stats, flag, list, then the note", () => {
  it("orders them and keeps the labels", async () => {
    const { user } = await setup([ex("Bench Press", { plannedSets: planned(3), sets: working(2) }), ex("Triceps Pushdown", { plannedSets: planned(3) })]);
    await openEndEarly(user);
    const dialog = endEarlyDialog();
    const text = dialog.textContent ?? "";
    const order = ["sets", "4 planned sets not logged", "Bench Press · 1 set", "Triceps Pushdown · 3 sets", "Unlogged sets aren't saved. You can't edit a workout after finishing it."].map((s) => text.indexOf(s));
    expect(order.every((n) => n >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(within(dialog).getByRole("button", { name: "End workout" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep logging" })).toBeInTheDocument();
  });

  it("says '1 planned set not logged' for one", async () => {
    const { user } = await setup([ex("A", { plannedSets: planned(2), sets: working(1) })]);
    await openEndEarly(user);
    expect(within(endEarlyDialog()).getByText("1 planned set not logged")).toBeInTheDocument();
  });
});

describe("17.2 AC3 — the flag is part of the shared body", () => {
  it("renders flag, list and then the note whenever unlogged.total > 0", () => {
    const stats = { minutes: 5, exercises: 1, sets: 1, volumeKg: null };
    const unlogged = { total: 2, planned: 2, byExercise: [{ id: "x", name: "Row", count: 2 }] };
    const { container } = render(<FinishDialogBody stats={stats} unitPreference="kg" unlogged={unlogged} note="A finished workout can't be edited." />);
    const text = container.textContent ?? "";
    expect(text.indexOf("2 planned sets not logged")).toBeGreaterThan(-1);
    expect(text.indexOf("2 planned sets not logged")).toBeLessThan(text.indexOf("Row · 2 sets"));
    expect(text.indexOf("Row · 2 sets")).toBeLessThan(text.indexOf("A finished workout can't be edited."));
  });
});

describe("17.2 AC5 — sets are working sets only, and Finish still counts every set", () => {
  it("6 warm-ups and 3 working sets read 3; Finish stays enabled and setCount is 9", async () => {
    const { fake, user } = await setup([ex("A", { sets: [...warmups(6), ...working(3, 7)] })]);
    await user.click(finishButton());
    expect(statTexts(finishDialog())).toEqual(["41 minduration", "1exercises", "3sets"]);
    await user.click(within(finishDialog()).getByRole("button", { name: "Finish" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ setCount: 9 }));
  });

  it("a workout of only warm-ups can still be finished and reads 0 sets", async () => {
    const { user } = await setup([ex("A", { sets: warmups(2) })]);
    expect(finishButton()).toBeEnabled();
    await user.click(finishButton());
    expect(statTexts(finishDialog())).toEqual(["41 minduration", "1exercises", "0sets"]);
  });
});

describe("17.2 AC6 — the dialog duration is captured when it opens", () => {
  it("does not tick while open and refreshes on the next open", async () => {
    const { user } = await setup([ex("A", { sets: working(1) })]);
    await user.click(finishButton());
    expect(statTexts(finishDialog())[0]).toBe("41 minduration");
    vi.setSystemTime(START + 51 * 60_000);
    expect(statTexts(finishDialog())[0]).toBe("41 minduration");
    await user.click(within(finishDialog()).getByRole("button", { name: "Keep logging" }));
    await user.click(finishButton());
    expect(statTexts(finishDialog())[0]).toBe("51 minduration");
  });
});

describe("17.2 AC7 — the finish call is unchanged", () => {
  it("End workout early still sends endedEarly and the unlogged count through the same PATCH", async () => {
    const { fake, user } = await setup([ex("A", { plannedSets: planned(3), sets: working(1) })]);
    await openEndEarly(user);
    await user.click(within(endEarlyDialog()).getByRole("button", { name: "End workout" }));
    await waitFor(() => expect(patches(fake)).toHaveLength(1));
    expect(observability.track).toHaveBeenCalledWith("workout_finished", expect.objectContaining({ endedEarly: true, unloggedPlannedSets: 2 }));
  });
});
