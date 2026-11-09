import { screen, waitFor, within } from "@testing-library/react";
import { chooseSegmentValue } from "../../test/controls";
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
vi.mock("../../observability/track", () => ({ track: observability.track }));
vi.mock("../../observability/reportError", () => ({ reportError: observability.reportError }));

import type { SectionTimer } from "@sin/core";
import { http, HttpResponse } from "msw";
import { API_BASE_URL } from "../../test/catalogHarness";
import { exerciseId, makeExercise } from "../../test/catalogFixtures";
import { server } from "../../test/msw/server";
import { card, makeCurrent, optionsButton } from "../../test/sessionHelpers";
import { makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../test/workoutFixtures";
import { createWorkoutFake, problemResponse, type WorkoutFakeOptions } from "../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../test/workoutHarness";

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
const ex = (name: string, sectionIndex: number | null = null, supersetGroup: number | null = null): ExerciseSpec => ({ modality: "weight_reps", name, sectionIndex, supersetGroup });
const SET5: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };

async function setup(opts: WorkoutDetailOptions, fakeOptions: Partial<WorkoutFakeOptions> = {}) {
  const fake = createWorkoutFake({ active: makeWorkoutDetail(opts), catalog: [bench], ...fakeOptions });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp("/app/workouts");
  await screen.findByRole("heading", { name: "Workout" });
  return { fake, ...app };
}
type Setup = Awaited<ReturnType<typeof setup>>;

const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const announcement = () => screen.getByTestId("session-announcement");
const groupPatches = (fake: Setup["fake"]) =>
  fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-exercises/") && typeof r.body === "object" && r.body !== null && "supersetGroup" in r.body);
const sectionPatchCount = (fake: Setup["fake"]) => fake.requests.filter((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-sections/")).length;
const groupsIn = (fake: Setup["fake"], sectionName: string) => {
  const w = fake.state.active!;
  const id = w.sections.find((s) => s.name === sectionName)!.id;
  return [...w.exercises].filter((e) => e.sectionId === id).sort((a, b) => a.position - b.position).map((e) => e.supersetGroup);
};
/** The section's cards draw one run: a bracket opens on the first and closes on the last (joints draw "middle"). */
const oneRun = (sectionName: string) => {
  const marks = Array.from(screen.getByRole("region", { name: sectionName }).querySelectorAll("[data-bracket]")).map((e) => e.getAttribute("data-bracket"));
  return marks.length > 0 && marks[0] === "first" && marks.at(-1) === "last" && marks.filter((m) => m === "first").length === 1;
};

async function setTimer(user: Setup["user"], section: string, format: "amrap" | "time_cap" | "set_timer" | "none", fill?: () => Promise<void>) {
  await user.click(screen.getByRole("button", { name: `Edit section ${section}` }));
  const dialog = sheet("Edit section");
  await chooseSegmentValue(user, "Timer", format, dialog);
  if (format === "amrap") await user.type(dialog.getByLabelText("Time limit"), "1200");
  if (format === "set_timer") {
    await user.type(dialog.getByLabelText("Rounds"), "5");
    await user.type(dialog.getByLabelText("Round length"), "500");
  }
  await fill?.();
  await user.click(dialog.getByRole("button", { name: "Save" }));
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull());
}
async function addBench(user: Setup["user"]) {
  await user.click(screen.getAllByRole("button", { name: "Add exercise" }).at(-1)!);
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Bench Press/ }));
}
async function moveInto(user: Setup["user"], exercise: string, section: string) {
  await makeCurrent(user, exercise);
  await user.click(optionsButton(exercise));
  await user.selectOptions(within(card(exercise)).getByLabelText("Section"), section);
}

describe("10.7 AC22 — when a workout groups (live)", () => {
  it("making 3 loose exercises AMRAP groups them after the section PATCH, and the bracket shows", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0), ex("C", 0)] });
    await setTimer(user, "Main", "amrap");
    await waitFor(() => expect(groupPatches(fake)).toHaveLength(3));
    const sectionAt = fake.requests.findIndex((r) => r.path.startsWith("/v1/workout-sections/"));
    const firstGroupAt = fake.requests.indexOf(groupPatches(fake)[0]!);
    expect(firstGroupAt).toBeGreaterThan(sectionAt);
    await waitFor(() => expect(oneRun("Main")).toBe(true));
    const groups = groupsIn(fake, "Main");
    expect(new Set(groups).size).toBe(1);
    expect(groups[0]).not.toBeNull();
  });

  it("Second Shift (two supersets) made Time Cap keeps its groups", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Second Shift" }], exercises: [ex("A", 0, 1), ex("B", 0, 1), ex("C", 0, 2), ex("D", 0, 2)] });
    await setTimer(user, "Second Shift", "time_cap");
    await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
    expect(groupPatches(fake)).toEqual([]);
    expect(groupsIn(fake, "Second Shift")).toEqual([1, 1, 2, 2]);
  });

  it("an exercise added into a timed single superset joins it", async () => {
    const { user, fake } = await setup({
      sections: [{ name: "Main", timer: SET5, addedInWorkout: true }],
      exercises: [ex("A", 0, 1), ex("B", 0, 1)],
    });
    await addBench(user);
    await waitFor(() => expect(groupsIn(fake, "Main")).toHaveLength(3));
    await waitFor(() => expect(new Set(groupsIn(fake, "Main")).size).toBe(1));
    expect(groupsIn(fake, "Main")[0]).not.toBeNull();
    expect(groupPatches(fake).length).toBeLessThanOrEqual(3);
  });

  it("an exercise moved into a timed section with two supersets stays loose", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0, 1), ex("B", 0, 1), ex("C", 0, 2), ex("D", 0, 2), ex("Row Erg")] });
    await moveInto(user, "Row Erg", "Main");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Row Erg to Main"));
    expect(groupPatches(fake)).toEqual([]);
    expect(groupsIn(fake, "Main")).toEqual([1, 1, 2, 2, null]);
  });

  it("an exercise moved into a timed section with one other exercise is grouped with it", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("Row Erg")] });
    await moveInto(user, "Row Erg", "Main");
    await waitFor(() => expect(groupPatches(fake).length).toBeGreaterThan(0));
    await waitFor(() => expect(oneRun("Main")).toBe(true));
  });

  describe("non-triggers", () => {
    it("a rename sends no group PATCH", async () => {
      const { user, fake } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("B", 0)] });
      await user.click(screen.getByRole("button", { name: "Edit section Main" }));
      await user.type(sheet("Edit section").getByLabelText("Name"), " set");
      await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
      await waitFor(() => expect(announcement()).toHaveTextContent("Section saved"));
      expect(groupPatches(fake)).toEqual([]);
    });

    it("5 → 6 rounds sends no group PATCH", async () => {
      const { user, fake } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("B", 0)] });
      await user.click(screen.getByRole("button", { name: "Edit section Main" }));
      await user.clear(sheet("Edit section").getByLabelText("Rounds"));
      await user.type(sheet("Edit section").getByLabelText("Rounds"), "6");
      await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
      await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
      expect(groupPatches(fake)).toEqual([]);
    });

    it("removing the timer sends no group PATCH", async () => {
      const { user, fake } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("B", 0)] });
      await setTimer(user, "Main", "none");
      await waitFor(() => expect(announcement()).toHaveTextContent("Timer saved"));
      expect(groupPatches(fake)).toEqual([]);
    });
  });
});

describe("10.7 AC23 — when grouping fails (live)", () => {
  it("after a timer save: the new plan shows, the banner offers Try again, which groups and clears it", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0)] }, { failRegroup: { times: 1 } });
    await setTimer(user, "Main", "amrap");
    const notice = await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    expect(within(screen.getByRole("region", { name: "Main" })).getByText("AMRAP 12:00")).toBeInTheDocument();
    const sections = sectionPatchCount(fake);
    expect(sections).toBe(1);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText("Timer saved, but the exercises couldn't be grouped — try again")).toBeNull());
    await waitFor(() => expect(oneRun("Main")).toBe(true));
    // The timer is never rolled back: no further section PATCH.
    expect(sectionPatchCount(fake)).toBe(1);
    expect(fake.state.active!.sections[0]!.timer).toEqual({ format: "amrap", capSeconds: 720 });
    expect(notice).not.toBeInTheDocument();
  });

  it("Try again after the group landed elsewhere sends no PATCH (Review Focus 3)", async () => {
    const { user, fake, queryClient } = await setup({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0)] }, { failRegroup: { times: 1 } });
    await setTimer(user, "Main", "amrap");
    await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    // Another device groups them, and the screen re-reads (as a focus refetch would).
    fake.state.active = { ...fake.state.active!, exercises: fake.state.active!.exercises.map((e) => ({ ...e, supersetGroup: 4 })) };
    await queryClient.invalidateQueries({ queryKey: ["workouts", "active"] });
    await waitFor(() => expect(oneRun("Main")).toBe(true));
    const before = groupPatches(fake).length;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/couldn't be grouped/)).toBeNull());
    expect(groupPatches(fake).length).toBe(before);
  });

  it("Try again after a regroup that partly landed groups them all (final review I-1)", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0), ex("C", 0), ex("D", 0)] });
    // The first two group PATCHes land, the third fails: the cache re-reads as a 2-of-4 superset.
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-exercises\// }, () => problemResponse(503, "about:blank"), 1, 2);
    await setTimer(user, "Main", "amrap");
    await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    const partial = groupsIn(fake, "Main");
    expect(partial.slice(0, 2).every((g) => g !== null)).toBe(true);
    expect(partial.slice(2)).toEqual([null, null]);
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.queryByText(/couldn't be grouped/)).toBeNull());
    await waitFor(() => expect(new Set(groupsIn(fake, "Main")).size).toBe(1));
    expect(groupsIn(fake, "Main")[0]).not.toBeNull();
  });

  it("the add path says Exercise added…", async () => {
    const { user } = await setup({ sections: [{ name: "Main", timer: SET5, addedInWorkout: true }], exercises: [ex("A", 0)] }, { failRegroup: { times: 1 } });
    await addBench(user);
    expect(await screen.findByText("Exercise added, but it couldn't be grouped — try again")).toBeInTheDocument();
  });

  it("the move path says Exercise moved…", async () => {
    const { user } = await setup({ sections: [{ name: "Main", timer: SET5 }], exercises: [ex("A", 0), ex("Row Erg")] }, { failRegroup: { times: 1 } });
    await moveInto(user, "Row Erg", "Main");
    expect(await screen.findByText("Exercise moved, but it couldn't be grouped — try again")).toBeInTheDocument();
  });

  it("nine loose exercises made Set Timer group the first 8 and show the cap line", async () => {
    const nine = Array.from({ length: 9 }, (_, i) => ex(`E${i + 1}`, 0));
    const { user, fake } = await setup({ sections: [{ name: "Main" }], exercises: nine });
    await setTimer(user, "Main", "set_timer");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Main" })).getByText("Only the first 8 exercises are grouped.")).toBeInTheDocument());
    const groups = groupsIn(fake, "Main");
    expect(new Set(groups.slice(0, 8)).size).toBe(1);
    expect(groups[8]).toBeNull();
  });

  it("Add exercise waits while grouping runs", async () => {
    const { user, fake } = await setup({ sections: [{ name: "Main" }], exercises: [ex("A", 0), ex("B", 0)] });
    const gate = deferred<void>();
    let held = false;
    server.use(
      http.patch(`${API_BASE_URL}/v1/workout-exercises/:id`, async () => {
        held = true;
        await gate.promise;
        return HttpResponse.error();
      }),
    );
    await setTimer(user, "Main", "amrap");
    await waitFor(() => expect(held).toBe(true));
    expect(screen.getAllByRole("button", { name: "Add exercise", hidden: true }).every((b) => b.hasAttribute("disabled"))).toBe(true);
    gate.resolve();
    await screen.findByText("Timer saved, but the exercises couldn't be grouped — try again");
    expect(fake.state.active!.sections[0]!.timer).toEqual({ format: "amrap", capSeconds: 720 });
  });
});
