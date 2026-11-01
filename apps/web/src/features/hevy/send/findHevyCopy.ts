import type { HevyClient } from "../client/hevyClient";

/** Spec 20.2 AC7, §6.3: how many pages of Hevy's workouts (10 each, newest first) the lost-response check reads. */
export const FIND_COPY_PAGES = 5;

/** Two start times closer than this are one instant (Hevy may drop the milliseconds the body sent). */
const SAME_INSTANT_MS = 1000;

export type FindResult = { kind: "found"; hevyWorkoutId: string } | { kind: "notFound" } | { kind: "inconclusive" };

/** Exercises holding at least one set: section markers and exercises whose sets were dropped don't count (minor 262). */
export const withSets = (exercises: readonly { sets: readonly unknown[] }[]): number => exercises.filter((e) => e.sets.length > 0).length;

/**
 * Spec 20.2 AC7, §6.3, D28 (owner decision, minor 262): looks for the copy an interrupted send may have made. A
 * candidate is a Hevy workout with the same start instant (parsed, so `Z`, `+00:00` and milliseconds don't matter) and
 * the same number of exercises with sets as the body that was built. One candidate is the copy, whatever its title (a
 * rename in between); several are settled by the title, and if it doesn't pick exactly one the answer is inconclusive.
 * Candidates are gathered page by page; a page reaching a workout older than the target's start, or the last page,
 * ends the search; five pages without that make an empty search inconclusive. Reads only; a failure propagates after
 * the client's own `GET` retries.
 */
export async function findHevyCopy(
  client: Pick<HevyClient, "listWorkouts">,
  target: { startTime: string; title: string; exercisesWithSets: number },
): Promise<FindResult> {
  const start = Date.parse(target.startTime);
  const candidates: { id: string; title: string }[] = [];
  let ended = false;
  for (let page = 1; page <= FIND_COPY_PAGES && !ended; page += 1) {
    const reply = await client.listWorkouts(page);
    for (const w of reply.workouts) {
      const at = Date.parse(w.start_time);
      // The body carries milliseconds; Hevy may keep whole seconds. Within a second is the same instant; a full
      // second apart is not.
      if (Math.abs(at - start) < SAME_INSTANT_MS && withSets(w.exercises) === target.exercisesWithSets) candidates.push({ id: w.id, title: w.title });
      if (at <= start - SAME_INSTANT_MS) ended = true;
    }
    if (page >= reply.page_count) ended = true;
  }
  if (candidates.length === 1) return { kind: "found", hevyWorkoutId: candidates[0]!.id };
  if (candidates.length > 1) {
    const titled = candidates.filter((c) => c.title === target.title);
    return titled.length === 1 ? { kind: "found", hevyWorkoutId: titled[0]!.id } : { kind: "inconclusive" };
  }
  return ended ? { kind: "notFound" } : { kind: "inconclusive" };
}
