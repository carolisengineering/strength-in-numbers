import { cleanup, screen, within } from "@testing-library/react";
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
const download = vi.hoisted(() => ({ saveBlob: vi.fn() }));
vi.mock("../../account/saveBlob", () => ({ saveBlob: download.saveBlob }));

import { ROUTINES_PER_USER_MAX, type HevyImportBatch, type HevyRoutine, type HevyWorkout } from "@sin/core";

import { setInstantPacing, USER_ID } from "../../../test/hevyHarness";
import { generateHevyWorkouts, GENERATED_TEMPLATE_IDS } from "../../../test/hevyImportFakes";
import { importButton, realBatches, setupImportRun, toSummary } from "../../../test/hevyImportRun";
import { pinTimeZone } from "../../../test/timeZone";
import { makeRoutine, routineId } from "../../../test/workoutFixtures";
import { cleanupApp } from "../../../test/workoutHarness";
import { hevyKeyStore } from "../keyStore";
import { resetImportLaneForTests } from "./importLane";

pinTimeZone("UTC");
beforeEach(() => {
  setInstantPacing();
  download.saveBlob.mockReset();
});
afterEach(() => {
  cleanup();
  hevyKeyStore.remove(USER_ID);
  resetImportLaneForTests();
  cleanupApp();
});

const doneSection = async () => (await screen.findByRole("heading", { level: 2, name: "Done" }, { timeout: 5000 })).closest("section") as HTMLElement;
const routineOf = (id: string, title: string): HevyRoutine => ({ id, title, folder_id: null, exercises: [{ index: 0, title: "x", exercise_template_id: GENERATED_TEMPLATE_IDS[0], sets: [] }] });

/** 20 workouts: 2 duplicates, 2 rejected, 1 with dropped sets (and an exercise with no sets left), 1 unreadable. */
function fixture() {
  const workouts: HevyWorkout[] = generateHevyWorkouts(20);
  const odd = workouts[19]!;
  workouts[19] = { ...odd, exercises: odd.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s, type: "mystery" })) })) };
  const dup = new Set([workouts[3]!.id, workouts[4]!.id]);
  const rejected = new Set([workouts[5]!.id, workouts[6]!.id]);
  return {
    workouts,
    imports: {
      duplicateOf: new Map([...dup].map((id, i) => [id, `00000000-0000-4000-8000-0000000000a${i}`])),
      outcomeFor: (id: string) => (rejected.has(id) ? ("rejected" as const) : undefined),
      dropsFor: (id: string) => (id === workouts[7]!.id ? [{ code: "set_out_of_range" as const, count: 3 }, { code: "exercise_no_sets" as const, count: 1 }] : []),
    },
  };
}

describe("20.1 AC25 — done screen", () => {
  it("shows imported, linked and skipped (the unreadable included), the sets dropped, and the links", async () => {
    const { workouts, imports: options } = fixture();
    const { imports } = setupImportRun(auth, { workouts, imports: options });
    const { user } = await toSummary();
    await user.click(importButton());
    const done = await doneSection();
    expect(within(done).getByText("15 workouts imported · 2 linked to workouts you'd logged · 3 skipped")).toBeInTheDocument();
    expect(within(done).getByText("3 sets dropped")).toBeInTheDocument();
    expect(await within(done).findByText("Records updated.")).toBeInTheDocument();
    expect(within(done).getByRole("link", { name: "View History" })).toHaveAttribute("href", "/app/history");
    expect(within(done).getByRole("link", { name: "Back to Hevy" })).toHaveAttribute("href", "/app/profile/hevy");
    expect(within(done).getByRole("button", { name: "Download report" })).toBeInTheDocument();
    // The unreadable workout was never in a real body.
    expect(realBatches(imports).flatMap((b: HevyImportBatch) => b.workouts.map((w) => w.hevyWorkoutId))).not.toContain(workouts[19]!.id);
  });

  it("counts the run's own results, not the dry run's", async () => {
    const workouts = generateHevyWorkouts(5);
    const { imports } = setupImportRun(auth, { workouts });
    const { user } = await toSummary();
    // Another tab imported one after the summary: the run answers already_imported for it.
    imports.links.set(workouts[0]!.id, "imported");
    await user.click(importButton());
    const done = await doneSection();
    expect(within(done).getByText("4 workouts imported · 0 linked to workouts you'd logged · 0 skipped")).toBeInTheDocument();
    expect(within(done).getByText("1 already in SIN")).toBeInTheDocument();
  });

  it("shows the routines created and already there, and the exercises created while pairing", async () => {
    const routines = [routineOf("r1", "Push A"), routineOf("r2", "Pull A")];
    const { fake } = setupImportRun(auth, { workouts: generateHevyWorkouts(3), routines });
    const { user } = await toSummary({ tick: ["Push A", "Pull A"] });
    // Pull A was created elsewhere after the checklist: the create answers routine-name-taken.
    fake.state.routines.set("existing", makeRoutine({ id: routineId(998), name: "Pull A" }));
    await user.click(importButton());
    const done = await doneSection();
    expect(within(done).getByText("1 routine created · 1 already there")).toBeInTheDocument();
  });

  it("code review 4: a routine with nothing to import is skipped, not counted as not created", async () => {
    const empty: HevyRoutine = { id: "r3", title: "Empty", folder_id: null, exercises: [] };
    setupImportRun(auth, { workouts: generateHevyWorkouts(2), routines: [routineOf("r1", "Push A"), empty] });
    const { user } = await toSummary({ tick: ["Push A", "Empty"] });
    await user.click(importButton());
    const done = await doneSection();
    expect(within(done).getByText("1 routine created · 1 with nothing to import")).toBeInTheDocument();
  });

  it("a routine limit lists the routines not created", async () => {
    const existing = Array.from({ length: ROUTINES_PER_USER_MAX - 1 }, (_, i) => makeRoutine({ id: routineId(100 + i), name: `Old ${i}` }));
    const routines = [routineOf("r1", "Push A"), routineOf("r2", "Pull A")];
    const { fake } = setupImportRun(auth, { workouts: generateHevyWorkouts(2), routines, existingRoutines: existing });
    const { user } = await toSummary({ tick: ["Push A"] });
    // Room was 1; another tab took it, so the first create hits the cap.
    fake.state.routines.set("late", makeRoutine({ id: routineId(999), name: "Late" }));
    await user.click(importButton());
    const done = await doneSection();
    expect(within(done).getByText("Your routine limit was reached; 1 routine wasn't created")).toBeInTheDocument();
    expect(within(done).getByRole("list", { name: "Routines not created" })).toHaveTextContent("Push A");
  });

  it("Stop then Finish up lists the workouts never sent (O2)", async () => {
    const { imports } = setupImportRun(auth, { workouts: generateHevyWorkouts(60) });
    const release = imports.gateRealBatch(1);
    const { user } = await toSummary();
    await user.click(importButton());
    await user.click(await screen.findByRole("button", { name: "Stop" }));
    release();
    await user.click(await screen.findByRole("button", { name: "Finish up" }));
    const done = await doneSection();
    expect(within(done).getByText("25 workouts imported · 0 linked to workouts you'd logged · 0 skipped")).toBeInTheDocument();
    expect(within(done).getByText("35 not imported (stopped)")).toBeInTheDocument();
  });

  it("Download report saves the CSV", async () => {
    const { workouts, imports: options } = fixture();
    setupImportRun(auth, { workouts, imports: options });
    const { user } = await toSummary();
    await user.click(importButton());
    const done = await doneSection();
    await user.click(within(done).getByRole("button", { name: "Download report" }));
    expect(download.saveBlob).toHaveBeenCalledTimes(1);
    const [blob, name] = download.saveBlob.mock.calls[0] as [Blob, string];
    expect(name).toBe("hevy-import-report.csv");
    const text = await blob.text();
    expect(text.split("\r\n")[0]).toBe("kind,date,title,outcome,detail");
    expect(text).toContain(",unreadable,");
  });
});
