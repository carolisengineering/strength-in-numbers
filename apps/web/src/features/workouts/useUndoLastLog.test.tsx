import type { MouseEvent } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutExerciseDetail } from "@sin/core";

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import type { LoggedEvent } from "./EntryRow";
import { useUndoLastLog } from "./useUndoLastLog";

const EXERCISE = { name: "Bench Press", modality: "weight_reps" as const };

function setup(options: { overlayOpen?: boolean } = {}) {
  const first = makeSet({ setNumber: 1 });
  const second = makeSet({ setNumber: 2, weight: 62.5, weightKg: 62.5 });
  const exercises = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: EXERCISE.name, sets: [first, second] }] }).exercises;
  const exerciseId = exercises[0]!.id;
  const event = (set: typeof first): LoggedEvent => ({ exerciseId, set, advance: true, wasExtra: false, value: `${set.weight} × ${set.reps}` });
  const wrapper = wrapperWith(makeQueryClient(), fakeClient({ deleteSet: async () => {} }));
  const props = { exercises: exercises as readonly WorkoutExerciseDetail[], overlayOpen: options.overlayOpen ?? false };
  const hook = renderHook(
    ({ exercises: list, overlayOpen }: typeof props) =>
      useUndoLastLog({
        exercises: list,
        ops: [],
        idMap: {},
        rest: null,
        overlayOpen,
        select: vi.fn(),
        focusLeavesWith: vi.fn(() => false),
        revealPanel: vi.fn(),
        onFailure: vi.fn(),
        announce: vi.fn(),
      }),
    { initialProps: props, wrapper },
  );
  const tap = () => ({ currentTarget: document.createElement("button") }) as unknown as MouseEvent<HTMLButtonElement>;
  return { ...hook, props, first, second, event, tap };
}

describe("minor 432 — useUndoLastLog on its own", () => {
  it("offerFrom offers the logged row", () => {
    const { result, first, event } = setup();
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    expect(result.current.offer?.row.id).toBe(first.id);
  });

  it("minor 423 — a new offer clears a pending restore", async () => {
    const { result, rerender, props, first, second, event, tap } = setup();
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    act(() => result.current.undo(tap()));
    await waitFor(() => expect(result.current.restore?.set.id).toBe(first.id));
    rerender({ ...props, exercises: props.exercises.map((e) => ({ ...e, sets: e.sets.filter((s) => s.id !== first.id) })) });
    act(() => result.current.offerFrom(event(second), EXERCISE, null));
    expect(result.current.restore).toBeNull();
  });

  it("Review Focus 2: end() keeps a pending restore (Options right after an Undo)", async () => {
    const { result, first, event, tap } = setup();
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    act(() => result.current.undo(tap()));
    await waitFor(() => expect(result.current.restore?.set.id).toBe(first.id));
    act(() => result.current.end());
    expect(result.current.restore?.set.id).toBe(first.id);
  });

  it("final review: after an Undo, an overlay opening clears the undone line too, and keeps the prefill (AC8, Review Focus 2)", async () => {
    const { result, rerender, props, first, event, tap } = setup();
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    act(() => result.current.undo(tap()));
    await waitFor(() => expect(result.current.restore?.set.id).toBe(first.id));
    expect(result.current.undoText).not.toBeNull();
    rerender({ ...props, overlayOpen: true });
    expect(result.current.undoText).toBeNull();
    expect(result.current.restore?.set.id).toBe(first.id);
  });

  it("minor 430 — an offer made while an overlay is open ends at once", () => {
    const { result, first, event } = setup({ overlayOpen: true });
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    expect(result.current.offer).toBeNull();
  });

  it("minor 430 — an offer held when an overlay opens ends, and doesn't come back when it closes", () => {
    const { result, rerender, props, first, event } = setup();
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    expect(result.current.offer?.row.id).toBe(first.id);
    rerender({ ...props, overlayOpen: true });
    expect(result.current.offer).toBeNull();
    rerender({ ...props, overlayOpen: false });
    expect(result.current.offer).toBeNull();
  });
});
