import type { QueryClient } from "@tanstack/react-query";
import type { Me, UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { track } from "../../observability/track";
import { ME_QUERY_KEY } from "../me/useMe";
import { applyFinishedCaches } from "../records/cache";
import { buildRecordLedger } from "../records/recordLedger";
import type { DraftStores } from "./drafts/draftStore";
import { emitWorkoutFinished } from "./finishEvents";
import { finishedCopy } from "./outbox/finish";
import type { LandedStore } from "./outbox/landedStore";
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
  /** AC27: where a landing the lifter didn't see is remembered for the one-time line. */
  landed?: Pick<LandedStore, "add">;
  /** AC27: true while the summary of that workout is open (it updates in place instead). */
  viewing?: (workoutId: string) => boolean;
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
 * detail, (2) the records caches, (3) the active entry, (4) drafts and the rest timer, (5) tracking, (6) the landed line's
 * entry unless the summary is open (AC27), (7) the Hevy event (`landed` and `ours` only, D9; once per workout per page
 * load, in `finishEvents`).
 */
export function createFinishLanding({ queryClient, drafts, rest, waiting, landed, viewing, now = Date.now }: FinishLandingDeps) {
  return (op: FinishOp, result: FinishSyncResult): void => {
    const id = op.workoutId;
    const active = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
    // The copy the lifts are counted from, read before (1) and (3) change the caches.
    const held = active?.id === id ? active : queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id));

    // (1) The detail: the re-read for `ours` / `elsewhere`; for `landed`, the response over the copy we hold (it has no
    // exercises). A copy seeded at the tap (the projection) may carry client set keys, so it is re-read afterwards.
    if (result.outcome === "landed") {
      const workout = withoutRecords(result.updated);
      // Minor 628: the response has no `routineIsOneOff` or sets, so the copy we hold is normalized as the finish did.
      if (held) queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), finishedCopy({ ...held, ...workout }, workout.endedAt ?? op.body.endedAt));
      if (held && active?.id !== id) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(id), exact: true });
    } else {
      queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(id), result.detail);
    }

    // (2) Records from `newRecords`, or none cached so the summary fetches them by workout id (08.0 AC6 / AC7).
    applyFinishedCaches(queryClient, id, result.outcome === "landed" ? result.updated.newRecords : null);

    // (3) A `null`, not a removal: the Workouts screen's mounted observer needs it to show Start (06.4 D1). Not while
    // a Finish tap waits on this op (minor 632): nulling it would unmount `ActiveSession` mid-tap and show Start; the
    // tap opens the summary, which clears the entry on mount (06.4 D1), or clears it itself after an unmount.
    if (active?.id === id && !waiting.has(op.id)) {
      // Minor 627: a read of `/active` already in flight (a reconnect or focus refetch) read the server before this
      // finish committed; cancel it, or its live copy would land on top of the null.
      void queryClient.cancelQueries({ queryKey: WORKOUT_KEYS.active, exact: true });
      queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, null);
    }

    // (4) The cloud has it: the lifter's typing and the rest timer are done with (D6).
    drafts?.clearWorkout(id);
    rest?.clearWorkout(id);

    // (5) Scalars only, from the op's meta (§9).
    if (result.outcome === "elsewhere") track("workout_finish_elsewhere", {});
    else trackFinished(op, result);

    // (6) The summary's own heading count (Spec 17.6, D18), or null when there is no response to count from.
    if (landed && !viewing?.(id)) {
      landed.add({ workoutId: id, lifts: result.outcome === "landed" ? liftsOf(result.updated, held) : null, how: result.outcome });
    }

    // (7) Last, once every cache is seeded (Spec 20.2 AC24).
    if (result.outcome !== "elsewhere") emitWorkoutFinished({ workoutId: id });
  };

  function liftsOf(updated: UpdatedWorkout, held: WorkoutDetail | undefined | null): number | null {
    if (!held) return null;
    const pref = queryClient.getQueryData<Me>(ME_QUERY_KEY)?.unitPreference ?? "kg";
    return buildRecordLedger({ records: updated.newRecords, workout: held, pref, section: "workouts" }).counted;
  }

  function trackFinished(op: FinishOp, result: Exclude<FinishSyncResult, { outcome: "elsewhere" }>): void {
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
  }
}
