import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkoutExerciseSchema, WorkoutSectionSchema, type WorkoutDetail, type WorkoutSection } from "@sin/core";

const observability = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));
vi.mock("../../../observability/reportError", () => ({ reportError: observability.reportError }));

import { ApiError } from "../../../api";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../../test/workoutHarness";
import { WORKOUT_KEYS } from "../queries";
import type { WorkoutClient } from "../workoutClient";
import { SECTION_COPY } from "./sectionCopy";
import { SectionDialogs } from "./SectionDialogs";
import { useSectionActions, type SectionActionDeps, type SectionActions } from "./useSectionActions";
import { useSectionMutations } from "./useSectionMutations";

afterEach(() => {
  observability.track.mockReset();
  observability.reportError.mockReset();
});

const OFFLINE = "You're offline — try again when you have signal";
const api = (status: number, slug = "about:blank") =>
  new ApiError({ status, type: slug === "about:blank" ? slug : `https://strengthinnumbers.app/problems/${slug}`, title: "t", requestId: "req-7" });
const network = () => ApiError.network("req-7", new Error("down"));

const baseWorkout = () =>
  makeWorkoutDetail({
    sections: [{ name: "Warm-up", notes: "5 min" }],
    exercises: [
      { modality: "weight_reps", name: "Row Erg", sectionIndex: 0 },
      { modality: "weight_reps", name: "Squat", sectionIndex: 0 },
      { modality: "weight_reps", name: "Bench", sectionIndex: null },
    ],
  });
const sectionOf = (w: WorkoutDetail, extra: Partial<WorkoutSection> = {}) =>
  WorkoutSectionSchema.parse({ id: "01900000-0000-7000-8000-0000000000aa", position: w.sections.length, name: "Cooldown", notes: null, addedInWorkout: true, ...extra });

type Deps = Omit<SectionActionDeps, "workout" | "mutations" | "structureLock">;

function Host({ workout, deps, lock, expose }: { workout: WorkoutDetail; deps: Deps; lock: { current: boolean }; expose: (a: SectionActions) => void }) {
  const mutations = useSectionMutations(workout.id);
  const actions = useSectionActions({ workout, mutations, structureLock: lock, ...deps });
  const exposeRef = useRef(expose);
  useEffect(() => {
    exposeRef.current(actions);
  });
  return (
    <>
      <button ref={actions.addSectionRef} onClick={actions.openAdd}>
        Open add
      </button>
      {workout.sections.map((s) => (
        <button key={s.id} ref={actions.editRefFor(s.id)} onClick={() => actions.openEdit(s.id)}>
          Open edit {s.name}
        </button>
      ))}
      <SectionDialogs actions={actions} sections={workout.sections} />
    </>
  );
}

function setup(overrides: Partial<WorkoutClient> = {}, workout: WorkoutDetail = baseWorkout()) {
  const qc = makeQueryClient();
  qc.setQueryData(WORKOUT_KEYS.active, workout);
  const invalidate = vi.spyOn(qc, "invalidateQueries");
  const order: string[] = [];
  const deps = {
    setBanner: vi.fn((b) => order.push(`banner:${b === null ? "null" : b.text}`)),
    announce: vi.fn((t: string) => order.push(`announce:${t}`)),
    refetch: vi.fn(async () => {
      order.push("refetch");
      return qc.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
    }),
    onGone: vi.fn(),
    offlineText: OFFLINE,
    onMoved: vi.fn(),
  };
  const lock = { current: false };
  let actions!: SectionActions;
  const client = fakeClient(overrides);
  const expose = (a: SectionActions) => (actions = a);
  const view = render(<Host workout={workout} deps={deps} lock={lock} expose={expose} />, { wrapper: wrapperWith(qc, client) });
  const rerender = (next: WorkoutDetail) => view.rerender(<Host workout={next} deps={deps} lock={lock} expose={expose} />);
  return { user: userEvent.setup(), qc, invalidate, deps, lock, order, workout, rerender, actions: () => actions };
}
const sheet = (name: string) => within(screen.getByRole("dialog", { name }));

describe("10.6 AC6 — add", () => {
  it("one POST with { name }; the sheet closes; one announcement; focus on Add section", async () => {
    const addSection = vi.fn(async (_w: string, body: { name: string }) => sectionOf(baseWorkout(), { name: body.name }));
    const { user, deps, workout } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), " Cooldown ");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "New section" })).toBeNull());
    expect(addSection).toHaveBeenCalledTimes(1);
    expect(addSection).toHaveBeenCalledWith(workout.id, { name: "Cooldown" });
    expect(deps.announce).toHaveBeenCalledTimes(1);
    expect(deps.announce).toHaveBeenCalledWith("Section added: Cooldown");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open add" })).toHaveFocus());
  });

  it("a typed note is sent", async () => {
    const addSection = vi.fn(async () => sectionOf(baseWorkout()));
    const { user, workout } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Strength");
    await user.type(sheet("New section").getByLabelText("Note"), "EMOM 10");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(addSection).toHaveBeenCalledWith(workout.id, { name: "Strength", notes: "EMOM 10" }));
  });

  it("two submits in one tick send one request (Review Focus 4)", async () => {
    const gate = deferred<WorkoutSection>();
    const addSection = vi.fn(() => gate.promise);
    const { user, actions, deps } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    act(() => {
      void actions().submitSheet({ name: "Cooldown", notes: "" });
      void actions().submitSheet({ name: "Cooldown", notes: "" });
    });
    gate.resolve(sectionOf(baseWorkout()));
    await waitFor(() => expect(deps.announce).toHaveBeenCalledTimes(1));
    expect(addSection).toHaveBeenCalledTimes(1);
  });

  it("an empty name sends nothing and shows the field error", async () => {
    const addSection = vi.fn();
    const { user } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    expect(sheet("New section").getByLabelText("Name")).toHaveAccessibleDescription(SECTION_COPY.nameRequired);
    expect(addSection).not.toHaveBeenCalled();
  });
});

describe("10.6 AC7 — edit", () => {
  it("sends only the changed keys; focus returns to that section's Edit", async () => {
    const updateSection = vi.fn(async (_id: string, body: object) => ({ ...baseWorkout().sections[0]!, ...body }));
    const { user, workout, deps } = setup({ updateSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    const note = sheet("Edit section").getByLabelText("Note");
    await user.clear(note);
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(updateSection).toHaveBeenCalledWith(workout.sections[0]!.id, { notes: null }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull());
    expect(deps.announce).toHaveBeenCalledWith("Section saved");
    await waitFor(() => expect(screen.getByRole("button", { name: "Open edit Warm-up" })).toHaveFocus());
  });

  it("an unchanged Save sends nothing and closes", async () => {
    const updateSection = vi.fn();
    const { user } = setup({ updateSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Edit section" })).toBeNull());
    expect(updateSection).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open edit Warm-up" })).toHaveFocus());
  });
});

describe("10.6 AC8 — remove", () => {
  it("nothing is sent until Remove; then one DELETE; the count is tracked; focus on Add section", async () => {
    const removeSection = vi.fn(async () => undefined);
    const { user, workout, deps } = setup({ removeSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    const confirm = sheet("Remove Warm-up?");
    expect(confirm.getByText("Its exercises and sets stay in the workout, without a section.")).toBeInTheDocument();
    expect(confirm.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(removeSection).not.toHaveBeenCalled();
    await user.click(confirm.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(removeSection).toHaveBeenCalledTimes(1));
    expect(removeSection).toHaveBeenCalledWith(workout.sections[0]!.id);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(deps.announce).toHaveBeenCalledWith("Section removed");
    expect(observability.track).toHaveBeenCalledWith("section_removed", { exerciseCount: 2 });
    await waitFor(() => expect(screen.getByRole("button", { name: "Open add" })).toHaveFocus());
  });

  it("Cancel sends nothing and returns focus to Remove section", async () => {
    const removeSection = vi.fn();
    const { user } = setup({ removeSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Warm-up?").getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Remove Warm-up?" })).toBeNull());
    expect(sheet("Edit section").getByRole("button", { name: "Remove section" })).toHaveFocus();
    expect(removeSection).not.toHaveBeenCalled();
  });

  it("a 404 counts as done", async () => {
    const removeSection = vi.fn(async () => Promise.reject(api(404, "not-found")));
    const { user, deps } = setup({ removeSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Warm-up?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deps.announce).toHaveBeenCalledWith("Section removed"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("10.6 AC12 — lock and online-only", () => {
  it("a held structure lock sends nothing", async () => {
    const addSection = vi.fn();
    const { user, lock, actions } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    lock.current = true;
    await act(async () => actions().submitSheet({ name: "Cooldown", notes: "" }));
    expect(addSection).not.toHaveBeenCalled();
  });

  it("offline: the offline text at once, in the open sheet", async () => {
    const addSection = vi.fn(async () => Promise.reject(network()));
    const { user } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Cooldown");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    expect(await sheet("New section").findByText(OFFLINE)).toBeInTheDocument();
    expect(sheet("New section").getByLabelText("Name")).toHaveValue("Cooldown");
  });

  it("the lock is taken during a write and released after", async () => {
    const gate = deferred<WorkoutSection>();
    const { user, lock, actions } = setup({ addSection: vi.fn(() => gate.promise) });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    act(() => {
      void actions().submitSheet({ name: "Cooldown", notes: "" });
    });
    expect(lock.current).toBe(true);
    await act(async () => gate.resolve(sectionOf(baseWorkout())));
    await waitFor(() => expect(lock.current).toBe(false));
  });
});

describe("10.6 AC13 / AC14 — failures", () => {
  it("add 500: refetch before the banner, no Try again, sheet closed", async () => {
    const { user, deps, order } = setup({ addSection: vi.fn(async () => Promise.reject(api(500))) });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Cooldown");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(deps.setBanner).toHaveBeenLastCalledWith({ tone: "warning", text: SECTION_COPY.addUnconfirmed, requestId: "req-7" }));
    expect(order.indexOf("refetch")).toBeLessThan(order.indexOf(`banner:${SECTION_COPY.addUnconfirmed}`));
    expect(screen.queryByRole("dialog", { name: "New section" })).toBeNull();
    expect(observability.reportError).not.toHaveBeenCalled();
  });

  it("add 409 workout-section-limit: the limit text in the sheet", async () => {
    const { user } = setup({ addSection: vi.fn(async () => Promise.reject(api(409, "workout-section-limit"))) });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Nine");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    expect(await sheet("New section").findByText(SECTION_COPY.limit)).toBeInTheDocument();
  });

  it("add 404: the gone path", async () => {
    const { user, deps } = setup({ addSection: vi.fn(async () => Promise.reject(api(404, "not-found"))) });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "X");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    await waitFor(() => expect(deps.onGone).toHaveBeenCalledTimes(1));
  });

  it("update 422 on name: the generic field text under Name", async () => {
    const err = new ApiError({ status: 422, type: "https://strengthinnumbers.app/problems/validation-error", title: "t", requestId: "r", errors: [{ path: "name", message: "x" }] });
    const { user } = setup({ updateSection: vi.fn(async () => Promise.reject(err)) });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(sheet("Edit section").getByLabelText("Name")).toHaveAccessibleDescription(SECTION_COPY.fieldsGeneric));
  });

  it("update 404: refetch, then That section no longer exists, the sheet closed, focus on Add section (Review Focus 5)", async () => {
    const { user, deps, order } = setup({ updateSection: vi.fn(async () => Promise.reject(api(404, "not-found"))) });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(deps.setBanner).toHaveBeenLastCalledWith({ tone: "warning", text: SECTION_COPY.sectionGone }));
    expect(order.indexOf("refetch")).toBeLessThan(order.indexOf(`banner:${SECTION_COPY.sectionGone}`));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.onGone).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole("button", { name: "Open add" })).toHaveFocus());
  });

  it("update 404 where the workout itself is gone: the gone path", async () => {
    const { user, deps, qc } = setup({ updateSection: vi.fn(async () => Promise.reject(api(404, "not-found"))) });
    deps.refetch.mockImplementation(async () => {
      qc.setQueryData(WORKOUT_KEYS.active, null);
      return null;
    });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(deps.onGone).toHaveBeenCalledTimes(1));
  });

  it("update 500: the sheet stays open with Couldn't save, Save is the retry", async () => {
    const { user, deps } = setup({ updateSection: vi.fn(async () => Promise.reject(api(500))) });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "!");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    expect(await sheet("Edit section").findByText(SECTION_COPY.saveFailed)).toBeInTheDocument();
    expect(deps.setBanner).not.toHaveBeenCalledWith(expect.objectContaining({ text: SECTION_COPY.saveFailed }));
  });

  it("move 500: Couldn't move with Try again, which re-sends { sectionId }; an unknown 409 is reported once", async () => {
    const setExerciseSection = vi
      .fn<WorkoutClient["setExerciseSection"]>()
      .mockRejectedValueOnce(api(500))
      .mockRejectedValueOnce(api(409, "something-else"));
    const { deps, actions, workout } = setup({ setExerciseSection });
    const bench = workout.exercises.find((e) => e.exerciseNameSnapshot === "Bench")!;
    const target = workout.sections[0]!.id;
    await act(async () => actions().setExerciseSection(bench, target));
    const banner = deps.setBanner.mock.calls.at(-1)![0];
    expect(banner).toMatchObject({ tone: "error", text: SECTION_COPY.moveFailed, requestId: "req-7" });
    expect(observability.reportError).not.toHaveBeenCalled();
    await act(async () => banner.retry());
    await waitFor(() => expect(observability.reportError).toHaveBeenCalledTimes(1));
    expect(setExerciseSection).toHaveBeenNthCalledWith(2, bench.id, target);
    expect(observability.reportError).toHaveBeenCalledWith(expect.anything(), { source: "workouts", op: "set-section" });
  });

  it("remove 500: Couldn't remove with Try again, both dialogs closed", async () => {
    const removeSection = vi.fn<WorkoutClient["removeSection"]>().mockRejectedValueOnce(api(500)).mockResolvedValueOnce(undefined);
    const { user, deps } = setup({ removeSection });
    await user.click(screen.getByRole("button", { name: "Open edit Warm-up" }));
    await user.click(sheet("Edit section").getByRole("button", { name: "Remove section" }));
    await user.click(sheet("Remove Warm-up?").getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(deps.setBanner).toHaveBeenLastCalledWith(expect.objectContaining({ text: SECTION_COPY.removeFailed, requestId: "req-7" })));
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => deps.setBanner.mock.calls.at(-1)![0].retry());
    await waitFor(() => expect(deps.announce).toHaveBeenCalledWith("Section removed"));
    expect(removeSection).toHaveBeenCalledTimes(2);
  });
});

describe("10.6 AC9 / AC10 — move", () => {
  it("one { sectionId } write; the announcement; onMoved with the id and the target section (#157)", async () => {
    const setExerciseSection = vi.fn(async (id: string, sectionId: string | null) =>
      WorkoutExerciseSchema.parse({ ...baseWorkout().exercises[2]!, id, sectionId }),
    );
    const { deps, actions, workout } = setup({ setExerciseSection });
    const bench = workout.exercises.find((e) => e.exerciseNameSnapshot === "Bench")!;
    const row = workout.exercises.find((e) => e.exerciseNameSnapshot === "Row Erg")!;
    await act(async () => actions().setExerciseSection(bench, workout.sections[0]!.id));
    expect(deps.announce).toHaveBeenLastCalledWith("Moved Bench to Warm-up");
    expect(deps.onMoved).toHaveBeenLastCalledWith(bench.id, workout.sections[0]!.id);
    await act(async () => actions().setExerciseSection(row, null));
    expect(deps.announce).toHaveBeenLastCalledWith("Moved Row Erg out of its section");
    expect(setExerciseSection.mock.calls).toEqual([
      [bench.id, workout.sections[0]!.id],
      [row.id, null],
    ]);
  });

  it("the current value sends nothing", async () => {
    const setExerciseSection = vi.fn();
    const { actions, workout } = setup({ setExerciseSection });
    const row = workout.exercises.find((e) => e.exerciseNameSnapshot === "Row Erg")!;
    await act(async () => actions().setExerciseSection(row, row.sectionId));
    expect(setExerciseSection).not.toHaveBeenCalled();
  });
});

describe("10.6 AC15 — live caches", () => {
  it("each success invalidates only the active workout; a failure leaves the cache as it was", async () => {
    const setExerciseSection = vi
      .fn<WorkoutClient["setExerciseSection"]>()
      .mockResolvedValueOnce(WorkoutExerciseSchema.parse(baseWorkout().exercises[0]!))
      .mockRejectedValueOnce(api(500));
    const { actions, workout, invalidate, qc } = setup({ setExerciseSection });
    const bench = workout.exercises.find((e) => e.exerciseNameSnapshot === "Bench")!;
    await act(async () => actions().setExerciseSection(bench, workout.sections[0]!.id));
    expect(invalidate.mock.calls).toEqual([[{ queryKey: WORKOUT_KEYS.active }]]);
    const before = structuredClone(qc.getQueryData(WORKOUT_KEYS.active));
    invalidate.mockClear();
    await act(async () => actions().setExerciseSection(bench, workout.sections[0]!.id));
    expect(invalidate).not.toHaveBeenCalled();
    expect(qc.getQueryData(WORKOUT_KEYS.active)).toEqual(before);
  });
});

describe("10.6 AC19 — live events", () => {
  it("each success emits exactly one scalar event, with no name, note or id", async () => {
    const w = baseWorkout();
    const client = {
      addSection: vi.fn(async () => sectionOf(w, { name: "ZebraSecQx" })),
      updateSection: vi.fn(async () => w.sections[0]!),
      removeSection: vi.fn(async () => undefined),
      setExerciseSection: vi.fn(async () => WorkoutExerciseSchema.parse(w.exercises[2]!)),
    };
    const { actions, workout } = setup(client, w);
    await act(async () => actions().openAdd());
    await act(async () => actions().submitSheet({ name: "ZebraSecQx", notes: "NoteSecQx" }));
    await act(async () => actions().openEdit(workout.sections[0]!.id));
    await act(async () => actions().submitSheet({ name: "Renamed", notes: "5 min" }));
    await act(async () => actions().setExerciseSection(workout.exercises[2]!, workout.sections[0]!.id));
    await act(async () => actions().openEdit(workout.sections[0]!.id));
    await act(async () => actions().requestRemove());
    await act(async () => actions().confirmRemove());
    expect(observability.track.mock.calls).toEqual([
      ["section_added"],
      ["section_edited"],
      ["exercise_sectioned"],
      ["section_removed", { exerciseCount: 2 }],
    ]);
    expect(JSON.stringify(observability.track.mock.calls)).not.toMatch(/ZebraSecQx|NoteSecQx|Warm-up|[0-9a-f]{8}-/);
  });
});

describe("10.6 AC13 — final review fixes", () => {
  it("409 workout-section-limit refetches so the row's count refreshes; the sheet stays open", async () => {
    const { user, deps } = setup({ addSection: vi.fn(async () => Promise.reject(api(409, "workout-section-limit"))) });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    await user.type(sheet("New section").getByLabelText("Name"), "Nine");
    await user.click(sheet("New section").getByRole("button", { name: "Add section" }));
    expect(await sheet("New section").findByText(SECTION_COPY.limit)).toBeInTheDocument();
    expect(deps.refetch).toHaveBeenCalledTimes(1);
  });

  it("a submit from the closing sheet after a success sends no second POST (Review Focus 4)", async () => {
    const addSection = vi.fn(async () => sectionOf(baseWorkout()));
    const { user, actions } = setup({ addSection });
    await user.click(screen.getByRole("button", { name: "Open add" }));
    const stale = actions();
    await act(async () => stale.submitSheet({ name: "Cooldown", notes: "" }));
    await act(async () => stale.submitSheet({ name: "Cooldown", notes: "" }));
    expect(addSection).toHaveBeenCalledTimes(1);
  });
});

describe("10.6 AC13 — code review fixes", () => {
  it("a move 404 because the exercise is gone refetches and shows no section banner", async () => {
    const { actions, workout, deps, qc } = setup({ setExerciseSection: vi.fn(async () => Promise.reject(api(404, "not-found"))) });
    const bench = workout.exercises.find((e) => e.exerciseNameSnapshot === "Bench")!;
    deps.refetch.mockImplementation(async () => {
      const fresh = { ...workout, exercises: workout.exercises.filter((e) => e.id !== bench.id) };
      qc.setQueryData(WORKOUT_KEYS.active, fresh);
      return fresh;
    });
    await act(async () => actions().setExerciseSection(bench, workout.sections[0]!.id));
    expect(deps.refetch).toHaveBeenCalledTimes(1);
    expect(deps.setBanner).not.toHaveBeenCalledWith(expect.objectContaining({ text: SECTION_COPY.sectionGone }));
    expect(deps.onGone).not.toHaveBeenCalled();
  });

  it("a remove that reaches the hook as a 404 (an edit-screen mutation set) is done: dialogs close, refetch, announce", async () => {
    const qc = makeQueryClient();
    const workout = baseWorkout();
    qc.setQueryData(WORKOUT_KEYS.active, workout);
    const deps = { setBanner: vi.fn(), announce: vi.fn(), refetch: vi.fn(async () => workout), onGone: vi.fn(), offlineText: OFFLINE, onMoved: vi.fn() };
    const mutations = {
      add: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(async () => Promise.reject(api(404, "not-found"))),
      setSection: vi.fn(),
      pending: false,
    };
    let actions!: SectionActions;
    function Bare() {
      actions = useSectionActions({ workout, mutations, structureLock: { current: false }, ...deps });
      return <SectionDialogs actions={actions} sections={workout.sections} />;
    }
    render(<Bare />, { wrapper: wrapperWith(qc, fakeClient()) });
    await act(async () => actions.openEdit(workout.sections[0]!.id));
    await act(async () => actions.requestRemove());
    await act(async () => actions.confirmRemove());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deps.refetch).toHaveBeenCalledTimes(1);
    expect(deps.announce).toHaveBeenCalledWith("Section removed");
  });

  it("Try again re-reads the exercise: if it already sits in the target section, nothing is sent", async () => {
    const setExerciseSection = vi.fn<WorkoutClient["setExerciseSection"]>().mockRejectedValueOnce(api(500));
    const { actions, workout, deps, rerender } = setup({ setExerciseSection });
    const bench = workout.exercises.find((e) => e.exerciseNameSnapshot === "Bench")!;
    const target = workout.sections[0]!.id;
    await act(async () => actions().setExerciseSection(bench, target));
    const retry = deps.setBanner.mock.calls.at(-1)![0].retry;
    rerender({ ...workout, exercises: workout.exercises.map((e) => (e.id === bench.id ? { ...e, sectionId: target } : e)) });
    await act(async () => retry());
    expect(setExerciseSection).toHaveBeenCalledTimes(1);
  });
});

describe("10.6 AC3 — no stale focus target at the cap (code review)", () => {
  it("at 8 sections a failure that closes the sheet does not aim focus at Add section (it is disabled there)", async () => {
    const w = makeWorkoutDetail({ sections: Array.from({ length: 8 }, (_, i) => ({ name: `S${i}` })), exercises: [] });
    const { user } = setup({ updateSection: vi.fn(async () => Promise.reject(api(404, "not-found"))) }, w);
    await user.click(screen.getByRole("button", { name: "Open edit S1" }));
    await user.type(sheet("Edit section").getByLabelText("Name"), "x");
    await user.click(sheet("Edit section").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("button", { name: "Open add" })).not.toHaveFocus();
  });
});

