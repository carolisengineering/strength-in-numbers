import { describe, expect, it } from "vitest";
import type { HevyWorkout, HevyWorkoutPage } from "@sin/core";

import { HevyError } from "../client/hevyErrors";
import { findHevyCopy, FIND_COPY_PAGES } from "./findHevyCopy";

const w = (id: string, start: string, title = "Push A"): HevyWorkout => ({ id, title, start_time: start, end_time: start, exercises: [] });

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

const target = { startTime: "2026-10-24T17:05:00.000Z", title: "Push A" };
const newer = (n: number, from = 0) => Array.from({ length: 10 }, (_, i) => w(`n${from + i}`, `2026-10-2${8 - Math.min(3, Math.floor(i / 4))}T0${i % 10}:00:00Z`));

describe("20.2 AC7 — findHevyCopy", () => {
  it("a match on page 2 is found with its id, and page 3 is never read", async () => {
    const p = pages([newer(10), [w("x", "2026-10-25T09:00:00Z"), w("h7", "2026-10-24T17:05:00Z")], newer(10, 20)]);
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
    expect(await findHevyCopy(p.client, { startTime: "2026-10-24T17:05:00.123Z", title: "Push A" })).toEqual({ kind: "found", hevyWorkoutId: "h1" });
    const q = pages([[w("x", "2026-10-24T17:05:00Z", "Other")], newer(10), newer(10, 10), newer(10, 20), newer(10, 30)], 9);
    expect(await findHevyCopy(q.client, { startTime: "2026-10-24T17:05:00.123Z", title: "Push A" })).toEqual({ kind: "inconclusive" });
  });

  it("the same start with a different title is not a match", async () => {
    const p = pages([[w("h1", "2026-10-24T17:05:00Z", "Pull A")]], 1);
    expect(await findHevyCopy(p.client, target)).toEqual({ kind: "notFound" });
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
