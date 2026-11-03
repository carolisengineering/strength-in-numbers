import { screen, waitFor, within } from "@testing-library/react";
import { onlineManager } from "@tanstack/react-query";
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
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SectionTimer, WorkoutDetail } from "@sin/core";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../../test/workoutFixtures";
import { createWorkoutFake } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HISTORY_KEYS } from "../../history/queries";
import { WORKOUT_KEYS } from "../queries";

let online = true;
vi.spyOn(navigator, "onLine", "get").mockImplementation(() => online);
beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(() => {
  online = true;
  onlineManager.setOnline(true);
  observability.track.mockReset();
  observability.reportError.mockReset();
  cleanupApp();
});

const bench = makeExercise({ id: exerciseId(1), name: "Bench Press", modality: "weight_reps" });
const ex = (name: string, sectionIndex: number | null = null): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })],
});
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const TWO_ROUNDS = [
  { round: 1, seconds: 221 },
  { round: 2, seconds: 218 },
];

async function openEdit(opts: WorkoutDetailOptions) {
  const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", ...opts });
  const fake = createWorkoutFake({ finished: [workout], catalog: [bench] });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
type Opened = Awaited<ReturnType<typeof openEdit>>;

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const announcement = () => screen.getByTestId("edit-announcement");
const sectionPatches = (fake: Opened["fake"]) => fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-sections/")).map((r) => r.body);

async function editTimer(user: Opened["user"], format: "amrap" | "none", name = "Main") {
  await user.click(screen.getByRole("button", { name: `Edit section ${name}` }));
  const dialog = sheet("Edit section");
  await user.selectOptions(dialog.getByLabelText("Timer"), format);
  if (format === "amrap") await user.type(dialog.getByLabelText("Time limit"), "1200");
  await user.click(dialog.getByRole("button", { name: "Save" }));
}

describe("10.7 AC16 — confirm before clearing (edit)", () => {
  it("a different format over round times asks; Change and clear sends discardResult", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }], exercises: [ex("Thruster", 0)] });
    await editTimer(user, "amrap");
    const confirm = await screen.findByRole("dialog", { name: "Change Main's timer?" });
    await waitFor(() => expect(within(confirm).getByRole("button", { name: "Cancel" })).toHaveFocus());
    expect(sectionPatches(fake)).toEqual([]);
    await user.click(within(confirm).getByRole("button", { name: "Change and clear" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(sectionPatches(fake)).toStrictEqual([{ timer: { format: "amrap", capSeconds: 720 }, discardResult: true }]);
    expect(fake.state.finished.get(workout.id)!.sections[0]).toMatchObject({ roundTimes: [], result: null });
  });

  it("Cancel sends nothing; with nothing recorded there is no dialog", async () => {
    const { user, fake } = await openEdit({ sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }, { name: "Other", timer: SET5 }], exercises: [ex("Thruster", 0)] });
    await editTimer(user, "amrap");
    const confirm = await screen.findByRole("dialog", { name: "Change Main's timer?" });
    await user.click(within(confirm).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(sheet("Edit section").getByRole("button", { name: "Save" })).toHaveFocus());
    expect(sectionPatches(fake)).toEqual([]);
    await user.click(sheet("Edit section").getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull());
    await editTimer(user, "amrap", "Other");
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(screen.queryByRole("dialog", { name: "Change Other's timer?" })).toBeNull();
    expect(sectionPatches(fake)).toStrictEqual([{ timer: { format: "amrap", capSeconds: 720 } }]);
  });
});

describe("10.7 AC19 — the timed heading on the edit screen", () => {
  it("shows the plan, score and times line, and (since Phase C) Log result", async () => {
    await openEdit({ sections: [{ name: "Main", timer: SET5, roundTimes: TWO_ROUNDS }], exercises: [ex("Thruster", 0)] });
    const main = screen.getByRole("region", { name: "Main" });
    expect(within(main).getByText("Set Timer 5 × 5:00 · total 7:19")).toBeInTheDocument();
    expect(within(main).getByText("Rounds 3:41 · 3:38")).toBeInTheDocument();
    expect(within(main).getByRole("button", { name: "Log result for Main" })).toBeInTheDocument();
  });
});

describe("10.7 AC26 — timer writes on the edit screen", () => {
  it("the returned section lands in the detail at its position; workout_edit section_timer_changed; editSucceeded once", async () => {
    const { user, workout, queryClient } = await openEdit({ sections: [{ name: "Warm-up" }, { name: "Main", timer: SET5 }], exercises: [ex("Thruster", 1)] });
    const reset = vi.spyOn(queryClient, "resetQueries");
    const activeTouched = vi.fn();
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (JSON.stringify(event.query.queryKey) === JSON.stringify(WORKOUT_KEYS.active)) activeTouched(event.type);
    });
    await editTimer(user, "amrap");
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    unsubscribe();
    const detail = queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id))!;
    expect(detail.sections.map((s) => [s.position, s.name, s.timer])).toEqual([
      [0, "Warm-up", null],
      [1, "Main", { format: "amrap", capSeconds: 720 }],
    ]);
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_edit")).toEqual([["workout_edit", { edit: "section_timer_changed" }]]);
    expect(observability.track.mock.calls.filter(([e]) => e === "section_timer_set")).toEqual([]);
    expect(reset.mock.calls.filter(([f]) => JSON.stringify(f?.queryKey) === JSON.stringify(HISTORY_KEYS.list))).toHaveLength(1);
    expect(activeTouched).not.toHaveBeenCalled();
  });

  it("a name-only change stays section_changed", async () => {
    const { user } = await openEdit({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("Thruster", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Main" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), " set");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section saved"));
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_edit")).toEqual([["workout_edit", { edit: "section_changed" }]]);
  });

  it("New section on the edit screen takes a timer", async () => {
    const { user, fake } = await openEdit({ exercises: [ex("Thruster")] });
    await user.click(screen.getByRole("button", { name: "Add section" }));
    const dialog = sheet("New section");
    await user.type(dialog.getByLabelText("Name"), "Finisher");
    await user.selectOptions(dialog.getByLabelText("Timer"), "amrap");
    await user.type(dialog.getByLabelText("Time limit"), "1200");
    await user.click(dialog.getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section added: Finisher"));
    expect(fake.requests.find((r) => r.method === "POST" && r.path.endsWith("/sections"))!.body).toStrictEqual({ name: "Finisher", timer: { format: "amrap", capSeconds: 720 } });
    expect(observability.track.mock.calls.filter(([e]) => e === "workout_edit")).toEqual([["workout_edit", { edit: "section_added" }]]);
  });
});
