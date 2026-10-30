import type { HevyClient } from "../client/hevyClient";

/** Spec 20.2 AC7, §6.3: how many pages of Hevy's workouts (10 each, newest first) the lost-response check reads. */
export const FIND_COPY_PAGES = 5;

/** Two start times closer than this are one instant (Hevy may drop the milliseconds the body sent). */
const SAME_INSTANT_MS = 1000;

export type FindResult = { kind: "found"; hevyWorkoutId: string } | { kind: "notFound" } | { kind: "inconclusive" };

/**
 * Spec 20.2 AC7, §6.3: looks for the copy an interrupted send may have made — a Hevy workout with the same start
 * instant (parsed, so `Z`, `+00:00` and milliseconds don't matter) and the same title as the body that was built.
 * A page reaching a workout older than the target's start makes "not found" conclusive; five pages without one, or
 * past the last page, decide it. Reads only; a failure propagates after the client's own `GET` retries.
 */
export async function findHevyCopy(client: Pick<HevyClient, "listWorkouts">, target: { startTime: string; title: string }): Promise<FindResult> {
  const start = Date.parse(target.startTime);
  for (let page = 1; page <= FIND_COPY_PAGES; page += 1) {
    const reply = await client.listWorkouts(page);
    let older = false;
    for (const w of reply.workouts) {
      const at = Date.parse(w.start_time);
      // The body carries milliseconds; Hevy may keep whole seconds. Within a second is the same instant; a full
      // second apart is not.
      if (Math.abs(at - start) < SAME_INSTANT_MS && w.title === target.title) return { kind: "found", hevyWorkoutId: w.id };
      if (at <= start - SAME_INSTANT_MS) older = true;
    }
    if (older || page >= reply.page_count) return { kind: "notFound" };
  }
  return { kind: "inconclusive" };
}
