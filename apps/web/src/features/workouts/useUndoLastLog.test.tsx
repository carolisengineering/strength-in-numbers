import type { MouseEvent } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { WorkoutExerciseDetail } from "@sin/core";

import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { deferred, fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import type { LoggedEvent } from "./EntryRow";
import { useUndoLastLog } from "./useUndoLastLog";

const EXERCISE = { name: "Bench Press", modality: "weight_reps" as const };

function setup(
  options: {
    overlayOpen?: boolean;
    onRender?: (r: ReturnType<typeof useUndoLastLog>) => void;
    select?: (exerciseId: string) => void;
    revealPanel?: () => void;
    currentNow?: () => string | null;
    deleteSet?: () => Promise<void>;
  } = {},
) {
  const first = makeSet({ setNumber: 1 });
  const second = makeSet({ setNumber: 2, weight: 62.5, weightKg: 62.5 });
  const exercises = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: EXERCISE.name, sets: [first, second] }] }).exercises;
  const exerciseId = exercises[0]!.id;
  const event = (set: typeof first): LoggedEvent => ({ exerciseId, set, advance: true, wasExtra: false, value: `${set.weight} × ${set.reps}` });
  const wrapper = wrapperWith(makeQueryClient(), fakeClient({ deleteSet: options.deleteSet ?? (async () => {}) }));
  const select = options.select ?? vi.fn();
  const revealPanel = options.revealPanel ?? vi.fn();
  const currentNow = options.currentNow ?? (() => exerciseId);
  const props = { exercises: exercises as readonly WorkoutExerciseDetail[], overlayOpen: options.overlayOpen ?? false };
  const hook = renderHook(
    ({ exercises: list, overlayOpen }: typeof props) => {
      const r = useUndoLastLog({
        exercises: list,
        ops: [],
        idMap: {},
        rest: null,
        overlayOpen,
        select,
        focusLeavesWith: vi.fn(() => false),
        revealPanel,
        currentNow,
        onFailure: vi.fn(),
        announce: vi.fn(),
      });
      options.onRender?.(r);
      return r;
    },
    { initialProps: props, wrapper },
  );
  const tap = () => ({ currentTarget: document.createElement("button") }) as unknown as MouseEvent<HTMLButtonElement>;
  return { ...hook, props, first, second, event, tap, exerciseId };
}

describe("minor 767 — Undo moves only if the lifter hasn't since the tap", () => {
  it("minor 767: the lifter moved to another card before the delete landed: Undo neither selects nor reveals, and still restores", async () => {
    const held = deferred<void>();
    const select = vi.fn();
    const revealPanel = vi.fn();
    let current = "";
    const { result, first, event, tap, exerciseId } = setup({ select, revealPanel, currentNow: () => current, deleteSet: () => held.promise });
    current = exerciseId;
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    act(() => result.current.undo(tap()));
    current = "B";
    await act(async () => held.resolve());
    await waitFor(() => expect(result.current.restore?.set.id).toBe(first.id));
    expect(select).not.toHaveBeenCalled();
    expect(revealPanel).not.toHaveBeenCalled();
  });

  it("Review Focus 3: with no move since the tap, Undo selects its card and reveals its panel", async () => {
    const select = vi.fn();
    const revealPanel = vi.fn();
    const { result, first, event, tap, exerciseId } = setup({ select, revealPanel });
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    act(() => result.current.undo(tap()));
    await waitFor(() => expect(revealPanel).toHaveBeenCalledWith(expect.objectContaining({ id: first.id })));
    expect(select).toHaveBeenCalledWith(exerciseId);
    expect(select.mock.invocationCallOrder[0]!).toBeLessThan(revealPanel.mock.invocationCallOrder[0]!);
    expect(result.current.restore?.set.id).toBe(first.id);
  });
});

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

  it("minor 714: while an overlay is open no render returns an offer or undo text", () => {
    const seen: (string | null)[] = [];
    const { result, first, event } = setup({ overlayOpen: true, onRender: (r) => seen.push(r.offer ? "offer" : r.undoText) });
    act(() => result.current.offerFrom(event(first), EXERCISE, null));
    expect(seen.filter((v) => v !== null)).toEqual([]);
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
