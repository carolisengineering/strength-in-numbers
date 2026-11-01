import { describe, expect, it } from "vitest";
import type { HevyWorkout, HevyWorkoutPage } from "@sin/core";

import { HevyError } from "../client/hevyErrors";
import { findHevyCopy, FIND_COPY_PAGES } from "./findHevyCopy";

/** One Hevy exercise; `sets` is how many sets it holds (0 for a section marker or an exercise whose sets were dropped). */
const ex = (index: number, sets: number): HevyWorkout["exercises"][number] => ({
  index,
  title: `E${index}`,
  exercise_template_id: `T${index}`,
  sets: Array.from({ length: sets }, () => ({ type: "normal", reps: 5 })),
});
/** A Hevy workout with `withSets` exercises that have a set and `empty` that have none. */
const w = (id: string, start: string, title = "Push A", withSets = 0, empty = 0): HevyWorkout => ({
  id,
  title,
  start_time: start,
  end_time: start,
  exercises: [...Array.from({ length: withSets }, (_, i) => ex(i, 2)), ...Array.from({ length: empty }, (_, i) => ex(withSets + i, 0))],
});

/** A fake `listWorkouts` over fixed pages (newest first), recording the pages read. */
function pages(list: HevyWorkout[][], pageCount = list.length) {
  const read: number[] = [];
  return {
    read,
    client: {
      listWorkouts: async (page: number): Promise<HevyWorkoutPage> => {
        read.push(page);
        return { page, page_count: pageCount, workouts: list[page - 1] ?? [] };
      },
    },
  };
}

const target = { startTime: "2026-10-24T17:05:00.000Z", title: "Push A", exercisesWithSets: 0 };
const newer = (n: number, from = 0) => Array.from({ length: 10 }, (_, i) => w(`n${from + i}`, `2026-10-2${8 - Math.min(3, Math.floor(i / 4))}T0${i % 10}:00:00Z`));

describe("20.2 AC7 — findHevyCopy", () => {
  it("a match on page 2 is found with its id, and page 3 is never read", async () => {
    // The older workout after the match ends the search on page 2 (minor 262: a match alone doesn't, since a second
    // workout with the same start could follow on the next page).
    const p = pages([newer(10), [w("x", "2026-10-25T09:00:00Z"), w("h7", "2026-10-24T17:05:00Z"), w("old", "2026-10-20T09:00:00Z")], newer(10, 20)]);
    expect(await findHevyCopy(p.client, target)).toEqual({ kind: "found", hevyWorkoutId: "h7" });
    expect(p.read).toEqual([1, 2]);
  });

  it.each([
    ["2026-10-24T17:05:00+00:00", true],
    ["2026-10-24T17:05:00Z", true],
    ["2026-10-24T17:05:00.000Z", true],
    ["2026-10-24T12:05:00-05:00", true],
    ["2026-10-24T17:05:01Z", false],
  ])("start %s matches: %s (instants are parsed, never compared as text)", async (start, matches) => {
    const p = pages([[w("h1", start)]], 1);
    expect((await findHevyCopy(p.client, target)).kind).toBe(matches ? "found" : "notFound");
  });

  it("final review I3: a start with milliseconds matches Hevy's whole second, and a whole second is not 'older'", async () => {
    const p = pages([[w("h1", "2026-10-24T17:05:00Z")]], 1);
    expect(await findHevyCopy(p.client, { ...target, startTime: "2026-10-24T17:05:00.123Z" })).toEqual({ kind: "found", hevyWorkoutId: "h1" });
    // Same instant but another exercise count: no candidate, and not "older" either, so the paging goes on.
    const q = pages([[w("x", "2026-10-24T17:05:00Z", "Other", 1)], newer(10), newer(10, 10), newer(10, 20), newer(10, 30)], 9);
    expect(await findHevyCopy(q.client, { ...target, startTime: "2026-10-24T17:05:00.123Z" })).toEqual({ kind: "inconclusive" });
  });

  it("minor 262: the same start and a different exercise count is not a match, whatever the title", async () => {
    const p = pages([[w("h1", "2026-10-24T17:05:00Z", "Push A", 3)]], 1);
    expect(await findHevyCopy(p.client, { ...target, exercisesWithSets: 2 })).toEqual({ kind: "notFound" });
  });

  it("an older workout on page 1 and no match is conclusive after one page", async () => {
    const p = pages([[w("a", "2026-10-26T09:00:00Z"), w("b", "2026-10-20T09:00:00Z")], newer(10)], 5);
    expect(await findHevyCopy(p.client, target)).toEqual({ kind: "notFound" });
    expect(p.read).toEqual([1]);
  });

  it("five full pages, all newer, no match: inconclusive after exactly five reads", async () => {
    const p = pages(Array.from({ length: 8 }, (_, i) => newer(10, i * 10)), 8);
    expect(await findHevyCopy(p.client, target)).toEqual({ kind: "inconclusive" });
    expect(p.read).toEqual([1, 2, 3, 4, 5]);
    expect(FIND_COPY_PAGES).toBe(5);
  });

  it("past the last page with no match: not found", async () => {
    const p = pages([newer(10), newer(10, 10)], 2);
    expect(await findHevyCopy(p.client, target)).toEqual({ kind: "notFound" });
    expect(p.read).toEqual([1, 2]);
  });

  it("a page that fails rethrows the same error", async () => {
    const failure = new HevyError("server", { status: 503 });
    const client = { listWorkouts: async () => Promise.reject(failure) };
    await expect(findHevyCopy(client, target)).rejects.toBe(failure);
  });
});

describe("20.2 AC7 / minor 262 — matched by start time and exercises with sets", () => {
  const two = { ...target, exercisesWithSets: 2 };
  const AT = "2026-10-24T17:05:00Z";

  it("a renamed copy is found: one candidate, another title", async () => {
    const p = pages([[w("h1", AT, "Renamed later", 2)]], 1);
    expect(await findHevyCopy(p.client, two)).toEqual({ kind: "found", hevyWorkoutId: "h1" });
  });

  it("Review Focus 3: exercises with no sets don't count, kept or dropped by Hevy", async () => {
    expect(await findHevyCopy(pages([[w("kept", AT, "Push A", 2, 1)]], 1).client, two)).toEqual({ kind: "found", hevyWorkoutId: "kept" });
    expect(await findHevyCopy(pages([[w("dropped", AT, "Push A", 2)]], 1).client, two)).toEqual({ kind: "found", hevyWorkoutId: "dropped" });
  });

  it("two candidates: the one with the title wins", async () => {
    const p = pages([[w("a", AT, "Other", 2), w("b", AT, "Push A", 2)]], 1);
    expect(await findHevyCopy(p.client, two)).toEqual({ kind: "found", hevyWorkoutId: "b" });
  });

  it.each([
    ["neither has the title", "Other", "Another"],
    ["both have the title", "Push A", "Push A"],
  ])("two candidates and %s: inconclusive", async (_l, t1, t2) => {
    const p = pages([[w("a", AT, t1, 2), w("b", AT, t2, 2)]], 1);
    expect(await findHevyCopy(p.client, two)).toEqual({ kind: "inconclusive" });
  });

  it("candidates on both sides of a page boundary are weighed together", async () => {
    const page1 = [...newer(10).slice(0, 9), w("a", AT, "Other", 2)];
    const p = pages([page1, [w("b", AT, "Push A", 2), w("old", "2026-10-20T09:00:00Z")]], 2);
    expect(await findHevyCopy(p.client, two)).toEqual({ kind: "found", hevyWorkoutId: "b" });
    expect(p.read).toEqual([1, 2]);
  });
});
