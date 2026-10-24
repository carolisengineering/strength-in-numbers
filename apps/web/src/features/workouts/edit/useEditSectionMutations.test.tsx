import { act, renderHook, waitFor } from "@testing-library/react";
import { useIsMutating } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

const observability = vi.hoisted(() => ({ track: vi.fn() }));
vi.mock("../../../observability/track", () => ({ track: observability.track }));

import type { WorkoutDetail, WorkoutExercise, WorkoutSection } from "@sin/core";
import { ApiError } from "../../../api";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../../test/workoutHarness";
import { makeWorkoutDetail } from "../../../test/workoutFixtures";
import { HISTORY_KEYS } from "../../history/queries";
import { WORKOUT_KEYS, useEditableWorkout } from "../queries";
import type { WorkoutClient } from "../workoutClient";
import { EDIT_MUTATION_KEY } from "./useEditMutations";
import { useEditSectionMutations } from "./useEditSectionMutations";

afterEach(() => observability.track.mockReset());

/** A finished workout with two sections (positions 0 and 2, so an add at 1 sorts between them) and three exercises. */
function seeded() {
  const qc = makeQueryClient();
  const base = makeWorkoutDetail({
    endedAt: "2026-10-02T11:00:00.000Z",
    sections: [{ name: "Warm-up" }, { name: "Strength", notes: "Heavy" }],
    exercises: [
      { modality: "weight_reps", name: "Row", sectionIndex: 0 },
      { modality: "weight_reps", name: "Bench Press", sectionIndex: 1 },
      { modality: "weight_reps", name: "Curl" },
    ],
  });
  const detail: WorkoutDetail = { ...base, sections: base.sections.map((s, i) => ({ ...s, position: i * 2 })) };
  qc.setQueryData(WORKOUT_KEYS.detail(detail.id), detail);
  qc.setQueryData(HISTORY_KEYS.list, { pages: [{ items: [], next: null }], pageParams: [null] });
  return { qc, detail };
}

const boom = () => new ApiError({ status: 500, type: "about:blank", title: "t", requestId: "r" });
const detailOf = (qc: ReturnType<typeof makeQueryClient>, id: string) => qc.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id))!;
const historyReset = (qc: ReturnType<typeof makeQueryClient>) => qc.getQueryState(HISTORY_KEYS.list)?.data === undefined;
const section = (over: Partial<WorkoutSection>): WorkoutSection => ({ id: "s-new", position: 1, name: "Core", notes: null, addedInWorkout: true, ...over });

function hookWith(qc: ReturnType<typeof makeQueryClient>, workoutId: string, edit: WorkoutClient, live: WorkoutClient = fakeClient()) {
  return renderHook(() => useEditSectionMutations(workoutId), { wrapper: wrapperWith(qc, live, edit) });
}

describe("10.6 AC18 — edit writes", () => {
  it("add: the REST client is called; the returned section is written into the detail in position order", async () => {
    const { qc, detail } = seeded();
    const live = fakeClient();
    const edit = fakeClient({ addSection: vi.fn(async () => section({})) });
    const { result } = hookWith(qc, detail.id, edit, live);
    await act(() => result.current.add({ name: "Core" }).then(() => undefined));
    expect(edit.addSection).toHaveBeenCalledWith(detail.id, { name: "Core" });
    expect(detailOf(qc, detail.id).sections.map((s) => s.name)).toEqual(["Warm-up", "Core", "Strength"]);
  });

  it("update: the section is replaced by id", async () => {
    const { qc, detail } = seeded();
    const stored = detail.sections[1]!;
    const edit = fakeClient({ updateSection: vi.fn(async () => ({ ...stored, name: "Power", notes: null })) });
    const { result } = hookWith(qc, detail.id, edit);
    await act(() => result.current.update(stored.id, { name: "Power", notes: null }).then(() => undefined));
    expect(edit.updateSection).toHaveBeenCalledWith(stored.id, { name: "Power", notes: null });
    expect(detailOf(qc, detail.id).sections.map((s) => [s.name, s.notes])).toEqual([["Warm-up", null], ["Power", null]]);
  });

  it.each(["remove", "move"] as const)("%s: the detail is re-read, and the promise resolves only after the re-read answered", async (op) => {
    const { qc, detail } = seeded();
    const reread = deferred<WorkoutDetail>();
    const after: WorkoutDetail = { ...detail, title: "Re-read" };
    let reads = 0;
    const edit = fakeClient({
      getById: vi.fn(() => (++reads === 1 ? Promise.resolve(detail) : reread.promise)),
      removeSection: vi.fn(async () => undefined),
      setExerciseSection: vi.fn(async () => detail.exercises[2] as unknown as WorkoutExercise),
    });
    const { result } = renderHook(
      () => ({ m: useEditSectionMutations(detail.id), q: useEditableWorkout(detail.id) }),
      { wrapper: wrapperWith(qc, fakeClient(), edit) },
    );
    await waitFor(() => expect(result.current.q.isFetching).toBe(false));
    let settled = false;
    act(() => {
      const run = op === "remove" ? result.current.m.remove(detail.sections[0]!.id, 1) : result.current.m.setSection(detail.exercises[2]!.id, detail.sections[0]!.id);
      void run.then(() => (settled = true));
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(settled).toBe(false);
    await act(async () => reread.resolve(after));
    await waitFor(() => expect(settled).toBe(true));
    expect(detailOf(qc, detail.id).title).toBe("Re-read");
    if (op === "remove") expect(edit.removeSection).toHaveBeenCalledWith(detail.sections[0]!.id);
    else expect(edit.setExerciseSection).toHaveBeenCalledWith(detail.exercises[2]!.id, detail.sections[0]!.id);
  });

  it("a 500 leaves the cached detail the same object and the history list untouched, for all four", async () => {
    const { qc, detail } = seeded();
    const before = detailOf(qc, detail.id);
    const edit = fakeClient({
      addSection: () => Promise.reject(boom()),
      updateSection: () => Promise.reject(boom()),
      removeSection: () => Promise.reject(boom()),
      setExerciseSection: () => Promise.reject(boom()),
    });
    const { result } = hookWith(qc, detail.id, edit);
    const s = detail.sections[0]!.id;
    await act(() => result.current.add({ name: "X" }).then(() => undefined, () => undefined));
    await act(() => result.current.update(s, { name: "X" }).then(() => undefined, () => undefined));
    await act(() => result.current.remove(s, 1).catch(() => undefined));
    await act(() => result.current.setSection(detail.exercises[0]!.id, null).then(() => undefined, () => undefined));
    expect(detailOf(qc, detail.id)).toBe(before);
    expect(historyReset(qc)).toBe(false);
    expect(observability.track).not.toHaveBeenCalled();
  });

  it("each write carries EDIT_MUTATION_KEY and `pending` while in flight; the live client is never called", async () => {
    const { qc, detail } = seeded();
    const response = deferred<WorkoutSection>();
    const live = fakeClient();
    const edit = fakeClient({ addSection: () => response.promise });
    const { result } = renderHook(
      () => ({ m: useEditSectionMutations(detail.id), keyed: useIsMutating({ mutationKey: EDIT_MUTATION_KEY }) }),
      { wrapper: wrapperWith(qc, live, edit) },
    );
    act(() => void result.current.m.add({ name: "Core" }));
    await waitFor(() => expect(result.current.keyed).toBe(1));
    expect(result.current.m.pending).toBe(true);
    await act(async () => response.resolve(section({})));
    await waitFor(() => expect(result.current.m.pending).toBe(false));
    expect(result.current.keyed).toBe(0);
  });

  it("Review Focus 1: the host unmounts while the add is in flight; the section is still written and editSucceeded still ran", async () => {
    const { qc, detail } = seeded();
    const response = deferred<WorkoutSection>();
    const edit = fakeClient({ addSection: () => response.promise });
    const { result, unmount } = hookWith(qc, detail.id, edit);
    act(() => void result.current.add({ name: "Core" }).catch(() => undefined));
    unmount();
    await act(async () => response.resolve(section({})));
    await waitFor(() => expect(detailOf(qc, detail.id).sections.map((s) => s.name)).toContain("Core"));
    expect(historyReset(qc)).toBe(true);
    expect(observability.track).toHaveBeenCalledWith("workout_edit", { edit: "section_added" });
  });

  it("Review Focus 2: a detail read in flight when a move answers does not leave the stale order", async () => {
    const { qc, detail } = seeded();
    const stale = deferred<WorkoutDetail>();
    const moved: WorkoutDetail = { ...detail, exercises: [...detail.exercises].reverse() };
    const getById = vi.fn().mockReturnValueOnce(stale.promise).mockImplementation(async () => moved);
    void qc.fetchQuery({ queryKey: WORKOUT_KEYS.detail(detail.id), queryFn: () => getById(), staleTime: 0 });
    const edit = fakeClient({ getById, setExerciseSection: vi.fn(async () => moved.exercises[0] as unknown as WorkoutExercise) });
    const { result } = renderHook(
      () => ({ m: useEditSectionMutations(detail.id), q: useEditableWorkout(detail.id) }),
      { wrapper: wrapperWith(qc, fakeClient(), edit) },
    );
    await act(() => result.current.m.setSection(detail.exercises[2]!.id, detail.sections[0]!.id).then(() => undefined));
    await act(async () => stale.resolve(detail));
    await new Promise((r) => setTimeout(r, 20));
    expect(detailOf(qc, detail.id).exercises.map((e) => e.id)).toEqual(moved.exercises.map((e) => e.id));
  });
});

describe("10.6 AC18 / AC21 — editSucceeded on every success", () => {
  it("after each of the four, History is reset and Progress / records invalidated; the live workout key is never named", async () => {
    const { qc, detail } = seeded();
    const s = detail.sections[0]!;
    const edit = fakeClient({
      getById: vi.fn(async () => detail),
      addSection: vi.fn(async () => section({})),
      updateSection: vi.fn(async () => ({ ...s, name: "Warm" })),
      removeSection: vi.fn(async () => undefined),
      setExerciseSection: vi.fn(async () => detail.exercises[0] as unknown as WorkoutExercise),
    });
    const reset = vi.spyOn(qc, "resetQueries");
    const invalidate = vi.spyOn(qc, "invalidateQueries");
    const { result } = hookWith(qc, detail.id, edit);
    const runs: (() => Promise<unknown>)[] = [
      () => result.current.add({ name: "Core" }),
      () => result.current.update(s.id, { name: "Warm" }),
      () => result.current.remove(s.id, 1),
      () => result.current.setSection(detail.exercises[0]!.id, null),
    ];
    for (const run of runs) {
      reset.mockClear();
      invalidate.mockClear();
      await act(() => run().then(() => undefined));
      expect(reset).toHaveBeenCalledWith({ queryKey: HISTORY_KEYS.list });
      const keys = invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
      expect(keys).toEqual(expect.arrayContaining([JSON.stringify(["progress"]), JSON.stringify(["records"])]));
      expect(keys).not.toContain(JSON.stringify(WORKOUT_KEYS.active));
    }
  });
});

describe("10.6 AC19 — events", () => {
  it("each success emits exactly one workout_edit with its kind, and none of the live section events", async () => {
    const { qc, detail } = seeded();
    const s = detail.sections[0]!;
    const edit = fakeClient({
      getById: vi.fn(async () => detail),
      addSection: vi.fn(async () => section({})),
      updateSection: vi.fn(async () => s),
      removeSection: vi.fn(async () => undefined),
      setExerciseSection: vi.fn(async () => detail.exercises[0] as unknown as WorkoutExercise),
    });
    const { result } = hookWith(qc, detail.id, edit);
    await act(() => result.current.add({ name: "Core" }).then(() => undefined));
    await act(() => result.current.update(s.id, { name: "Warm" }).then(() => undefined));
    await act(() => result.current.remove(s.id, 3));
    await act(() => result.current.setSection(detail.exercises[0]!.id, null).then(() => undefined));
    expect(observability.track.mock.calls).toEqual([
      ["workout_edit", { edit: "section_added" }],
      ["workout_edit", { edit: "section_changed" }],
      ["workout_edit", { edit: "section_removed" }],
      ["workout_edit", { edit: "exercise_sectioned" }],
    ]);
  });
});
