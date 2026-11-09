import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateSet, SetEntry, WorkoutExerciseDetail } from "@sin/core";

const trackSpy = vi.hoisted(() => vi.fn());
vi.mock("../../observability/track", () => ({ track: trackSpy }));

import { fakeClient, makeQueryClient, wrapperWith } from "../../test/workoutHarness";
import { makeSet, makeWorkoutDetail } from "../../test/workoutFixtures";
import { DraftStoresContext } from "./drafts/DraftStoreContext";
import { EntryRow, type DraftRestore, type LoggedEvent } from "./EntryRow";

afterEach(() => {
  trackSpy.mockReset();
  vi.useRealTimers();
  cleanup();
});

const UNDONE = { setNumber: 2, setType: "warmup", weight: 47.5, weightUnit: "kg", reps: 6, weightKg: 47.5 } as const;

const EXERCISE = makeWorkoutDetail({ exercises: [{ modality: "weight_reps", name: "Bench", sets: [] }] }).exercises[0]!;
const exerciseWith = (sets: SetEntry[]): WorkoutExerciseDetail => ({ ...EXERCISE, sets });

interface Options {
  drafts?: { weight: string; reps: string };
  restore?: DraftRestore;
}

function setup(start: SetEntry[], options: Options = {}) {
  const creates: CreateSet[] = [];
  const client = fakeClient({
    createSet: (_id, body) => {
      creates.push(body);
      return Promise.resolve(makeSet({ setNumber: 9, weight: body.weight, reps: body.reps, setType: body.setType, clientGeneratedId: body.clientGeneratedId }));
    },
  });
  const Base = wrapperWith(makeQueryClient(), client);
  const stored = options.drafts
    ? {
        forWorkout: () => ({
          get: () => ({ ...options.drafts!, distance: "", minutes: "", seconds: "", rpe: "", calories: "", weightUnit: "kg" as const, distanceUnit: "km" as const, setType: "working" as const }),
          set: vi.fn(),
          clearExercise: vi.fn(),
          clearWorkout: vi.fn(),
          retainOnly: vi.fn(),
          flush: vi.fn(),
          dispose: vi.fn(),
        }),
        clearWorkout: vi.fn(),
        flushAll: vi.fn(),
      }
    : null;
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <Base>
      <DraftStoresContext.Provider value={stored}>{children}</DraftStoresContext.Provider>
    </Base>
  );
  const done = vi.fn();
  const logged = vi.fn<(event: LoggedEvent) => void>();
  const row = (sets: SetEntry[], restore?: DraftRestore) => (
    <EntryRow exercise={exerciseWith(sets)} unitPreference="kg" onGone={vi.fn()} onLogged={logged} logExtra {...(restore ? { restore, onRestoreDone: done } : {})} />
  );
  const view = render(row(start, options.restore), { wrapper: Wrapper });
  return { creates, done, logged, update: (sets: SetEntry[], restore?: DraftRestore) => view.rerender(row(sets, restore)) };
}

const weight = () => screen.getByLabelText<HTMLInputElement>("Weight");
const reps = () => screen.getByLabelText<HTMLInputElement>("Reps");
const logTap = () => fireEvent.click(screen.getByRole("button", { name: "Log extra set" }));
const restoreOf = (set: SetEntry, token = 1): DraftRestore => ({ token, exerciseId: EXERCISE.id, set });

describe("17.5 AC11 — the undone set's values come back", () => {
  it("weight, unit, reps and a warm-up type, after the row has left", () => {
    const first = makeSet({ setNumber: 1, weight: 60, reps: 8, weightKg: 60 });
    const undone = makeSet(UNDONE);
    const { update, done } = setup([first, undone]);
    update([first], restoreOf(undone));
    expect(weight().value).toBe("47.5");
    expect(reps().value).toBe("6");
    expect(screen.getByRole("form").getAttribute("data-set-type")).toBe("warmup");
    expect(done).toHaveBeenCalledWith(1);
  });

  it("waits while the row is still listed, then wins over the re-seed when it leaves", () => {
    const first = makeSet({ setNumber: 1, weight: 60, reps: 8, weightKg: 60 });
    const undone = makeSet(UNDONE);
    const { update, done } = setup([first, undone]);
    const seeded = weight().value;
    update([first, undone], restoreOf(undone));
    expect(weight().value).toBe(seeded);
    expect(done).not.toHaveBeenCalled();
    update([first], restoreOf(undone));
    expect(weight().value).toBe("47.5");
    expect(reps().value).toBe("6");
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("a row listed by its client key still counts as listed", () => {
    const key = "00000000-0000-4000-8000-00000000000c";
    const undone = makeSet({ ...UNDONE, id: key, clientGeneratedId: key });
    const synced = makeSet({ ...UNDONE, clientGeneratedId: key });
    const { update, done } = setup([synced]);
    update([synced], restoreOf(undone));
    expect(done).not.toHaveBeenCalled();
  });

  it("a panel mounted with the row already gone takes it too (the advance case)", () => {
    const undone = makeSet(UNDONE);
    const { done } = setup([], { restore: restoreOf(undone) });
    expect(weight().value).toBe("47.5");
    expect(done).toHaveBeenCalledWith(1);
  });

  it("applies once: a later re-render with the same token doesn't undo the lifter's own typing", () => {
    const undone = makeSet(UNDONE);
    const { update } = setup([]);
    update([], restoreOf(undone));
    fireEvent.change(reps(), { target: { value: "7" } });
    update([], restoreOf(undone));
    expect(reps().value).toBe("7");
  });

  it("an edited draft is kept and the restore dropped, and the parent still hears it's done", () => {
    const undone = makeSet(UNDONE);
    const { update, done } = setup([]);
    fireEvent.change(reps(), { target: { value: "11" } });
    update([], restoreOf(undone));
    expect(reps().value).toBe("11");
    expect(weight().value).not.toBe("47.5");
    expect(done).toHaveBeenCalledWith(1);
  });

  it("a stored draft is kept the same way", () => {
    const undone = makeSet(UNDONE);
    const { update, done } = setup([], { drafts: { weight: "99", reps: "3" } });
    update([], restoreOf(undone));
    expect(weight().value).toBe("99");
    expect(reps().value).toBe("3");
    expect(done).toHaveBeenCalledWith(1);
  });

  it("a log of the restored draft is a prefill, not an edit, under a new client key", async () => {
    const key = "00000000-0000-4000-8000-00000000000c";
    const undone = makeSet({ ...UNDONE, clientGeneratedId: key });
    const { update, creates } = setup([]);
    update([], restoreOf(undone));
    logTap();
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(creates[0]).toMatchObject({ weight: 47.5, reps: 6, setType: "warmup" });
    expect(creates[0]!.clientGeneratedId).not.toBe(key);
    await waitFor(() => expect(trackSpy).toHaveBeenCalledWith("set_logged", expect.objectContaining({ edited: false })));
  });

  it("the next log's draft follows seedDraft, not the restored type", async () => {
    const undone = makeSet(UNDONE);
    const { update, creates, logged } = setup([]);
    update([], restoreOf(undone));
    logTap();
    await waitFor(() => expect(creates).toHaveLength(1));
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(screen.getByRole("form").getAttribute("data-set-type")).toBe("working");
  });

  it("the logged event carries the label's value, without 'Log '", async () => {
    const undone = makeSet(UNDONE);
    const { update, logged } = setup([]);
    update([], restoreOf(undone));
    logTap();
    await waitFor(() => expect(logged).toHaveBeenCalled());
    expect(logged.mock.calls[0]![0].value).toBe("47.5 × 6");
  });
});

describe("17.5 AC14 — Undo ends the panel's own window", () => {
  it("log, restore within 600 ms, tap Log: a second create goes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(1_000_000);
    const first = makeSet({ setNumber: 1, weight: 60, reps: 8, weightKg: 60 });
    const { update, creates, logged } = setup([first]);
    logTap();
    await waitFor(() => expect(logged).toHaveBeenCalled());
    vi.setSystemTime(1_000_100);
    update([first], restoreOf(logged.mock.calls[0]![0].set));
    await act(async () => {
      logTap();
      await Promise.resolve();
    });
    await waitFor(() => expect(creates).toHaveLength(2));
  });
});
