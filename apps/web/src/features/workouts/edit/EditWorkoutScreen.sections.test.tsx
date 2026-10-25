import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { screen, waitFor, within } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { HttpResponse } from "msw";
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

import type { WorkoutDetail } from "@sin/core";
import { exerciseId, makeExercise } from "../../../test/catalogFixtures";
import { card, makeCurrent, optionsButton } from "../../../test/sessionHelpers";
import { makePersonalRecord, makeSet, makeWorkoutDetail, type ExerciseSpec, type WorkoutDetailOptions } from "../../../test/workoutFixtures";
import { createWorkoutFake, problemResponse } from "../../../test/workoutFake";
import { cleanupApp, deferred, prepareApp, renderApp } from "../../../test/workoutHarness";
import { HISTORY_KEYS } from "../../history/queries";
import { SECTION_COPY } from "../sections/sectionCopy";
import { EDIT_COPY } from "./editCopy";

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
const set1 = () => [makeSet({ setNumber: 1, weight: 60, reps: 8 })];
const ex = (name: string, sectionIndex: number | null = null, extra: Partial<ExerciseSpec> = {}): ExerciseSpec => ({
  modality: "weight_reps",
  name,
  sectionIndex,
  sets: set1(),
  ...extra,
});

type Fake = ReturnType<typeof createWorkoutFake>;

async function openEdit(
  opts: WorkoutDetailOptions,
  fakeOptions: Partial<Parameters<typeof createWorkoutFake>[0]> = {},
  adjust: (w: WorkoutDetail) => WorkoutDetail = (w) => w,
) {
  const workout = adjust(makeWorkoutDetail({ endedAt: "2026-10-02T11:00:00.000Z", ...opts }));
  const fake = createWorkoutFake({ finished: [workout], catalog: [bench], ...fakeOptions });
  prepareApp({ auth, fake, catalog: [bench] });
  const app = renderApp(`/app/history/${workout.id}/edit`);
  await screen.findByRole("heading", { level: 1, name: "Edit workout" });
  return { fake, workout, ...app };
}
type Opened = Awaited<ReturnType<typeof openEdit>>;

const stored = (fake: Fake, id: string): WorkoutDetail => fake.state.finished.get(id)!;
const sheet = (name: string) => within(screen.getByRole("dialog", { name }));
const announcement = () => screen.getByTestId("edit-announcement");
const regionNames = () => screen.queryAllByRole("region").map((r) => r.querySelector("h2")?.textContent);
const sectionSelect = (name: string | RegExp) => within(card(name)).getByLabelText("Section");
const detailReads = (fake: Fake, id: string) => fake.requests.filter((r) => r.method === "GET" && r.path === `/v1/workouts/${id}`).length;
const sectionWrites = (fake: Fake) =>
  fake.requests.filter((r) => r.method !== "GET" && (r.path.includes("/sections") || r.path.startsWith("/v1/workout-sections/") || r.path.startsWith("/v1/workout-exercises/")));

async function addSection(user: Opened["user"], name: string) {
  await user.click(screen.getByRole("button", { name: "Add section" }));
  await user.type(sheet("New section").getByLabelText("Name"), name);
  await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
}
async function pickBench(user: Opened["user"]) {
  await user.click(screen.getAllByRole("button", { name: "Add exercise" }).at(-1)!);
  const dialog = await screen.findByRole("dialog", { name: "Add exercise" });
  await user.click(within(within(dialog).getByRole("region", { name: "All exercises" })).getByRole("button", { name: /Bench Press/ }));
}

// ---- AC17: one fixture, both screens, the same controls

const PARITY: WorkoutDetailOptions = {
  sections: [{ name: "Warm-up", notes: "Easy" }, { name: "Cooldown", addedInWorkout: true }],
  exercises: [ex("Row Erg", 0), ex("Squat"), ex("Curl", 0)],
};

/** Everything a lifter can read or reach in the section controls, in a fixed order. */
async function controls(user: Opened["user"], name: string) {
  const texts: string[] = [];
  texts.push(...screen.getAllByRole("button", { name: /^Edit section/ }).map((b) => b.getAttribute("aria-label") ?? b.textContent ?? ""));
  texts.push(within(screen.getByRole("region", { name: "Cooldown" })).getByText(SECTION_COPY.empty).textContent!);
  texts.push(screen.getByText("Cooldown", { selector: "strong" }).parentElement!.textContent!);
  texts.push(screen.getByRole("button", { name: "Add section" }).textContent!);
  await user.click(optionsButton(name));
  const select = sectionSelect(name);
  texts.push(...within(select).getAllByRole("option").map((o) => o.textContent!));
  await user.click(optionsButton(name));
  await user.click(screen.getByRole("button", { name: "Add section" }));
  const add = sheet("New section");
  texts.push(add.getByRole("heading").textContent!, ...add.getAllByRole("textbox").map((t) => t.getAttribute("name") ?? (t as HTMLInputElement).labels?.[0]?.textContent ?? ""));
  texts.push(...add.getAllByRole("button").map((b) => b.textContent!));
  await user.click(add.getByRole("button", { name: "Cancel" }));
  await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
  const edit = sheet("Edit section");
  texts.push(...edit.getAllByRole("textbox").map((t) => (t as HTMLInputElement).value));
  texts.push(...edit.getAllByRole("button").map((b) => b.textContent!));
  await user.click(edit.getByRole("button", { name: "Remove section" }));
  const confirm = sheet("Remove Warm-up?");
  texts.push(confirm.getByText(SECTION_COPY.removeLine).textContent!, ...confirm.getAllByRole("button").map((b) => b.textContent!));
  return texts;
}

describe("10.6 AC17 — same controls", () => {
  it("the live and the edit screen show the same section controls with the same texts", async () => {
    const editScreen = await openEdit(PARITY);
    const onEdit = await controls(editScreen.user, "Squat");
    cleanupApp();
    document.body.innerHTML = "";

    const fake = createWorkoutFake({ active: makeWorkoutDetail(PARITY), catalog: [bench] });
    prepareApp({ auth, fake, catalog: [bench] });
    const live = renderApp("/app/workouts");
    await screen.findByRole("heading", { name: "Workout" });
    await makeCurrent(live.user, "Squat");
    const onLive = await controls(live.user, "Squat");

    expect(onEdit).toEqual(onLive);
    expect(onEdit).toContain("New exercises go into Cooldown.");
    expect(onEdit.filter((t) => t.startsWith("Edit section"))).toEqual(["Edit section Warm-up", "Edit section Cooldown"]);
  });

  it("the edit screen is not a mode of ActiveSession (import scan)", () => {
    const source = readFileSync(resolve(__dirname, "EditWorkoutScreen.tsx"), "utf8");
    expect(source).not.toMatch(/from\s+["'][^"']*ActiveSession["']/);
    expect(source).not.toMatch(/sections\/useSectionMutations/);
  });
});

describe("10.6 AC18 — edit flows end to end", () => {
  it("add: the heading appears from the response with no detail re-read; the status line says so", async () => {
    const { user, fake, workout } = await openEdit({ exercises: [ex("Row Erg")] });
    const reads = detailReads(fake, workout.id);
    await addSection(user, "Core");
    expect(await screen.findByRole("region", { name: "Core" })).toBeInTheDocument();
    expect(announcement()).toHaveTextContent("Section added: Core");
    expect(detailReads(fake, workout.id)).toBe(reads);
    expect(stored(fake, workout.id).sections.map((s) => s.name)).toEqual(["Core"]);
  });

  it("edit: Save renames the heading", async () => {
    const { user, fake } = await openEdit({ sections: [{ name: "Warm-up", notes: "Easy" }], exercises: [ex("Row Erg", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    await user.clear(sheet("Edit section").getByLabelText("Name"));
    await user.type(sheet("Edit section").getByLabelText("Name"), "Prep");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("region", { name: "Prep" })).toBeInTheDocument();
    expect(fake.requests.find((r) => r.method === "PATCH" && r.path.startsWith("/v1/workout-sections/"))!.body).toStrictEqual({ name: "Prep" });
    expect(announcement()).toHaveTextContent("Section saved");
  });

  it("remove (the same exercise in two sections, Review Focus 5): one DELETE, a re-read, the exercises loose, no set touched", async () => {
    // One lineage twice: both rows point at the same catalog exercise.
    const { user, fake, workout } = await openEdit(
      { sections: [{ name: "Warm-up" }, { name: "Main" }], exercises: [ex("Bench Press", 0), ex("Bench Press", 1)] },
      {},
      (w) => ({ ...w, exercises: w.exercises.map((e) => ({ ...e, exerciseId: bench.id })) }),
    );
    const reads = detailReads(fake, workout.id);
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Warm-up?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(regionNames()).not.toContain("Warm-up"));
    expect(sectionWrites(fake).map((r) => r.method)).toEqual(["DELETE"]);
    expect(detailReads(fake, workout.id)).toBeGreaterThan(reads);
    expect(stored(fake, workout.id).exercises.map((e) => e.sectionId === null)).toEqual([true, false]);
    expect(fake.requests.filter((r) => r.path.startsWith("/v1/sets"))).toEqual([]);
    expect(announcement()).toHaveTextContent("Section removed");
  });

  it("move: one { sectionId } PATCH, a re-read, the card under its section with its heading focused", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    const reads = detailReads(fake, workout.id);
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Warm-up" })).getByRole("article", { name: "Row Erg" })).toBeInTheDocument());
    expect(sectionWrites(fake).map((r) => r.body)).toStrictEqual([{ sectionId: stored(fake, workout.id).sections[0]!.id }]);
    expect(detailReads(fake, workout.id)).toBeGreaterThan(reads);
    await waitFor(() => expect(within(card("Row Erg")).getByRole("heading", { level: 2 })).toHaveFocus());
    expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up");
  });

  it("#157 — a move whose re-read fails: a later unrelated change does not focus that card", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    fake.failNext({ method: "GET", path: new RegExp(`^/v1/workouts/${workout.id}$`) }, () => HttpResponse.error() as Response);
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up"));
    // The re-read failed: the old placement stays on screen.
    expect(within(screen.getByRole("region", { name: "Warm-up" })).queryByRole("article", { name: "Row Erg" })).toBeNull();
    const focus = vi.spyOn(within(card("Row Erg")).getByRole("heading", { level: 2 }), "focus");
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    await user.clear(sheet("Edit section").getByLabelText("Name"));
    await user.type(sheet("Edit section").getByLabelText("Name"), "Warm");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.getByRole("region", { name: "Warm" })).toBeInTheDocument());
    expect(focus).not.toHaveBeenCalled();
  });

  it("#157 — a move whose re-read fails: a later refetch that shows the move does not pull focus to it (code review)", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    fake.failNext({ method: "GET", path: new RegExp(`^/v1/workouts/${workout.id}$`) }, () => HttpResponse.error() as Response);
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up"));
    const elsewhere = screen.getByRole("button", { name: "Add section" });
    elsewhere.focus();
    focusManager.setFocused(false);
    focusManager.setFocused(true); // the lifter comes back to the tab: a refetch shows the move
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Warm-up" })).getByRole("article", { name: "Row Erg" })).toBeInTheDocument());
    focusManager.setFocused(undefined);
    expect(within(card("Row Erg")).getByRole("heading", { level: 2 })).not.toHaveFocus();
  });

  it("Done waits while a section write is in flight", async () => {
    const { user, fake } = await openEdit({ exercises: [ex("Row Erg")] });
    const held = deferred<void>();
    fake.failNext({ method: "POST", path: /\/sections$/ }, (async () => {
      await held.promise;
      return problemResponse(500, "about:blank");
    }) as unknown as () => Response);
    await addSection(user, "Core");
    await waitFor(() => expect(within(screen.getByTestId("edit-bar")).getByRole("button", { name: "Done" })).toBeDisabled());
    held.resolve();
    await waitFor(() => expect(within(screen.getByTestId("edit-bar")).getByRole("button", { name: "Done" })).toBeEnabled());
  });
});

describe("10.6 AC20 — edit failures", () => {
  it("offline: the edit screen's offline text, in the sheet", async () => {
    const { user, fake } = await openEdit({ exercises: [ex("Row Erg")] });
    online = false;
    fake.setOffline(true);
    await addSection(user, "Core");
    expect(await sheet("New section").findByText(EDIT_COPY.offline)).toBeInTheDocument();
  });

  it("a section 404 on Save: re-read, the sectionGone banner, the sheet closed", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () => problemResponse(404, "not-found"));
    const reads = detailReads(fake, workout.id);
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await screen.findByText(SECTION_COPY.sectionGone)).toBeInTheDocument();
    expect(detailReads(fake, workout.id)).toBeGreaterThan(reads);
    expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull();
  });

  it("a workout 404 (the re-read 404s too): the vanished view and no further section request (Review Focus 4)", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    fake.state.finished.delete(workout.id);
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await screen.findByText(EDIT_COPY.vanished)).toBeInTheDocument();
    expect(screen.queryByText(SECTION_COPY.sectionGone)).toBeNull();
    expect(sectionWrites(fake)).toHaveLength(1);
  });

  it("a section 404 whose re-read fails offline: the sectionGone banner, never the vanished view (final review)", async () => {
    const { user, fake, workout } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Row Erg", 0)] });
    await user.click(screen.getByRole("button", { name: "Edit section Warm-up" }));
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-sections\// }, () => problemResponse(404, "not-found"));
    fake.failNext({ method: "GET", path: new RegExp(`^/v1/workouts/${workout.id}$`) }, () => HttpResponse.error() as Response);
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await screen.findByText(SECTION_COPY.sectionGone)).toBeInTheDocument();
    expect(screen.queryByText(EDIT_COPY.vanished)).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Edit workout" })).toBeInTheDocument();
  });

  it("add 500: re-read before the addUnconfirmed banner, with no Try again", async () => {
    const { user, fake, workout } = await openEdit({ exercises: [ex("Row Erg")] });
    fake.failNext({ method: "POST", path: /\/sections$/ }, () => problemResponse(500, "about:blank"));
    const reads = detailReads(fake, workout.id);
    await addSection(user, "Core");
    const notice = await screen.findByText(SECTION_COPY.addUnconfirmed);
    expect(detailReads(fake, workout.id)).toBeGreaterThan(reads);
    expect(within(notice.closest("[role]") ?? notice.parentElement!).queryByRole("button", { name: "Try again" })).toBeNull();
  });

  it("a 409 workout-would-be-empty is not special-cased: a move shows the generic move row", async () => {
    const { user, fake } = await openEdit({ sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] });
    fake.failNext({ method: "PATCH", path: /^\/v1\/workout-exercises\// }, () => problemResponse(409, "workout-would-be-empty"));
    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    expect(await screen.findByText(SECTION_COPY.moveFailed)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Delete this whole workout/ })).toBeNull();
  });
});

describe("10.6 AC21 — derived data", () => {
  it("after a move, an add, a rename and a remove: History reset, Progress and records invalidated, each time", async () => {
    const records = (w: WorkoutDetail) => [makePersonalRecord({ workoutId: w.id, recordType: "heaviest_weight", exerciseName: "Row Erg", value: 60, previousValue: null })];
    const { user, queryClient } = await openEdit(
      { sections: [{ name: "Warm-up" }], exercises: [ex("Squat", 0), ex("Row Erg")] },
      { recordsFor: records },
    );
    const reset = vi.spyOn(queryClient, "resetQueries");
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const check = async () => {
      await waitFor(() => expect(reset).toHaveBeenCalledWith({ queryKey: HISTORY_KEYS.list }));
      const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
      expect(keys).toEqual(expect.arrayContaining([JSON.stringify(["progress"]), JSON.stringify(["records"])]));
      reset.mockClear();
      invalidate.mockClear();
    };

    await user.click(optionsButton("Row Erg"));
    await user.selectOptions(sectionSelect("Row Erg"), "Warm-up");
    await waitFor(() => expect(announcement()).toHaveTextContent("Moved Row Erg to Warm-up"));
    await check();
    await addSection(user, "Core");
    await waitFor(() => expect(announcement()).toHaveTextContent("Section added: Core"));
    await check();
    await user.click(screen.getByRole("button", { name: "Edit section Core" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "s");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section saved"));
    await check();
    await user.click(screen.getByRole("button", { name: "Edit section Cores" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Cores?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(announcement()).toHaveTextContent("Section removed"));
    await check();
  });
});

describe("10.6 AC17 / AC4 — a routine workout on the edit screen (Review Focus 3)", () => {
  it("all sections copied: no line, an add lands loose; after Add section the line appears and the next add lands in it", async () => {
    const { user } = await openEdit({ routineName: "Push", sections: [{ name: "Warm-up" }, { name: "Main" }], exercises: [ex("Squat", 0), ex("Row Erg", 1)] });
    expect(screen.queryByText(/New exercises go into/)).toBeNull();
    await pickBench(user);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Other exercises" })).getByRole("article", { name: "Bench Press" })).toBeInTheDocument());
    await addSection(user, "Finisher");
    expect(await screen.findByText("Finisher", { selector: "strong" })).toBeInTheDocument();
    await pickBench(user);
    await waitFor(() => expect(within(screen.getByRole("region", { name: "Finisher" })).getByRole("article", { name: "Bench Press" })).toBeInTheDocument());
  });
});
