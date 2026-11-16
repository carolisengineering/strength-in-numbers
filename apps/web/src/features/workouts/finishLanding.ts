import type { QueryClient } from "@tanstack/react-query";
import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { track } from "../../observability/track";
import { applyFinishedCaches } from "../records/cache";
import type { DraftStores } from "./drafts/draftStore";
import { emitWorkoutFinished } from "./finishEvents";
import type { FinishOp } from "./outbox/ops";
import type { FinishSyncResult } from "./outbox/outbox";
import { WORKOUT_KEYS } from "./queries";
import type { RestStores } from "./restStore";

export interface FinishLandingDeps {
  queryClient: QueryClient;
  drafts?: Pick<DraftStores, "clearWorkout">;
  rest?: Pick<RestStores, "clearWorkout">;
  /** Finish op ids a Finish tap is still waiting on, within its budget: their landing was never shown as "saved on this phone". */
  waiting: ReadonlySet<string>;
  now?: () => number;
}

/** `newRecords` belongs to the records cache, never to the workout detail (Spec 08.0 AC5). */
function withoutRecords(updated: UpdatedWorkout): Omit<UpdatedWorkout, "newRecords"> {
  const workout: Partial<UpdatedWorkout> = { ...updated };
  delete workout.newRecords;
  return workout as Omit<UpdatedWorkout, "newRecords">;
}

/**
 * Spec 06.7 AC14, §6.6, D10: the one owner of a finish's landing effects, wired to the outbox's `onFinishSynced`, which
 * calls it before any `whenFinishSettles` waiter resolves. Nothing here runs at the tap. In order: (1) the summary's
 * detail, (2) the records caches, (3) the active entry, (4) drafts and the rest timer, (5) tracking, (7) the Hevy event
 * (`landed` and `ours` only, D9; once per workout per page load, in `finishEvents`). Step (6), the landed line, is the
 * provider's (AC27).
 */
export function createFinishLanding({ queryClient, drafts, rest, waiting, now = Date.now }: FinishLandingDeps) {
  return (op: FinishOp, result: FinishSyncResult): void => {
    const id = op.workoutId;
    const active = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);

    // (1) The detail: the re-read for `ours` / `elsewhere`; for `landed`, the response over the copy we hold (it has no
    // exercises). A copy seeded at the tap (the projection) may carry client set keys, so it is re-read afterwards.
    if (result.outcome === "landed") {
      const workout = withoutRecords(result.updated);
      const fromActive = active?.id === id ? active : undefined;
      const base = fromActive ?? queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id));
      if (base) queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), { ...base, ...workout });
      if (base && !fromActive) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(id), exact: true });
    } else {
      queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), result.detail);
    }

    // (2) Records from `newRecords`, or none cached so the summary fetches them by workout id (08.0 AC6 / AC7).
    applyFinishedCaches(queryClient, id, result.outcome === "landed" ? result.updated.newRecords : null);

    // (3) A `null`, not a removal: the Workouts screen's mounted observer needs it to show Start (06.4 D1).
    if (active?.id === id) queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, null);

    // (4) The cloud has it: the lifter's typing and the rest timer are done with (D6).
    drafts?.clearWorkout(id);
    rest?.clearWorkout(id);

    // (5) Scalars only, from the op's meta (§9).
    if (result.outcome === "elsewhere") {
      track("workout_finish_elsewhere", {});
      return;
    }
    const { meta } = op;
    const endedAt = result.outcome === "landed" ? (result.updated.endedAt ?? op.body.endedAt) : (result.detail.endedAt ?? op.body.endedAt);
    const queued = !waiting.has(op.id);
    track("workout_finished", {
      exerciseCount: meta.exerciseCount,
      setCount: meta.setCount,
      durationMin: Math.round((Date.parse(endedAt) - Date.parse(meta.startedAt)) / 60_000),
      endedEarly: meta.endedEarly,
      unloggedPlannedSets: meta.unloggedPlannedSets,
      hadPlannedDuration: meta.hadPlannedDuration,
      queued,
      ...(queued ? { waitedMs: Math.max(0, now() - op.enqueuedAt) } : {}),
      ...(result.outcome === "ours" ? { viaReplay: true } : {}),
    });

    // (7) Last, once every cache is seeded (Spec 20.2 AC24).
    emitWorkoutFinished({ workoutId: id });
  };
}
