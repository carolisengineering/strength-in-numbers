import { screen, waitFor, within } from "@testing-library/react";
import { chooseSegmentValue } from "../../../test/controls";
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

import type { SectionTimer } from "@sin/core";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { card, optionsButton } from "../../../test/sessionHelpers";
import { makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../../test/workoutFixtures";
import { createWorkoutFake, type WorkoutFakeOptions } from "../../../test/workoutFake";
import { cleanupApp, prepareApp, renderApp } from "../../../test/workoutHarness";

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
const ex = (name: string, sectionIndex: number | null = null, supersetGroup: number | null = null): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  supersetGroup,
  sets: [makeSet({ setNumber: 1, weight: 60, reps: 8 })],
});
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };

async function openEdit(opts: WorkoutDetailOptions, fakeOptions: Partial<WorkoutFakeOptions> = {}) {
  const workout = makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", ...opts });
  const fake = createWorkoutFake({ finished: [workout], catalog: [bench], ...fakeOptions });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
type Opened = Awaited<ReturnType<typeof openEdit>>;

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const groupPatches = (fake: Opened["fake"]) =>
  fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/") && typeof r.body === "object" && r.body !== null && "supersetGroup" in r.body);
const groupsIn = (fake: Opened["fake"], id: string, sectionName: string) => {
  const w = fake.state.finished.get(id)!;
  const sid = w.sections.find((s) => s.name === sectionName)!.id;
  return [...w.exercises].filter((e) => e.sectionId === sid).sort((a, b) => a.position - b.position).map((e) => e.supersetGroup);
};

async function makeAmrap(user: Opened["user"], section: string) {
  await user.click(screen.getByRole("button", { name: `Edit section ${section}` }));
  const dialog = sheet("Edit section");
  await chooseSegmentValue(user, "Timer", "amrap", dialog);
  await user.type(dialog.getByLabelText("Time limit"), "1200");
  await user.click(dialog.getByRole("button", { name: "Save" }));
}

describe("10.7 AC22 — when a workout groups (edit)", () => {
  it("making 3 loose exercises AMRAP groups them; workout_edit exercise_regrouped follows section_timer_changed", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0), ex("C", 0)] });
    await makeAmrap(user, "Main");
    await waitFor(() => expect(groupPatches(fake)).toHaveLength(3));
    await waitFor(() => expect(new Set(groupsIn(fake, workout.id, "Main")).size).toBe(1));
    await waitFor(() =>
      expect(observability.track.mock.calls.filter(([e]) => e === "workout_edit").map(([, p]) => p)).toEqual([
        { edit: "section_timer_changed" },
        { edit: "exercise_regrouped" },
      ]),
    );
  });

  it("Second Shift made AMRAP keeps its groups", async () => {
    const { user, fake } = await openEdit({ sections: [{ name: "Second Shift" }], exercises: [ex("A", 0, 1), ex("B", 0, 1), ex("C", 0, 2), ex("D", 0, 2)] });
    await makeAmrap(user, "Second Shift");
    await waitFor(() => expect(screen.getByTestId("edit-announcement")).toHaveTextContent("Timer saved"));
    expect(groupPatches(fake)).toEqual([]);
  });

  it("a move into a timed section with one other exercise groups the two", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("Row Erg")] });
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(within(card("Row Erg")).getByLabelText("Section"), "Main");
    await waitFor(() => expect(groupPatches(fake).length).toBeGreaterThan(0));
    await waitFor(() => expect(new Set(groupsIn(fake, workout.id, "Main")).size).toBe(1));
  });
});

describe("10.7 AC23 — when grouping fails (edit)", () => {
  it("the banner offers Try again, which groups and clears it; the timer stays", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0)] }, { failRegroup: { times: 1 } });
    await makeAmrap(user, "Main");
    await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    expect(fake.state.finished.get(workout.id)!.sections[0]!.timer).toEqual({ format: "amrap", capSeconds: 720 });
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/couldn't be grouped/)).toBeNull());
    await waitFor(() => expect(new Set(groupsIn(fake, workout.id, "Main")).size).toBe(1));
    expect(fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-sections/"))).toHaveLength(1);
  });
});
