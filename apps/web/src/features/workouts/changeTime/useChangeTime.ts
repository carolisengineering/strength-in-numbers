import { useMutation, useQueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";
import { track } from "../../../observability/track";
import { applyEditedCaches } from "../../records/cache";
import { mergeWorkout } from "../edit/editCache";
import { EDIT_MUTATION_KEY } from "../edit/useEditMutations";
import { WORKOUT_KEYS } from "../queries";
import { guardReads, rereadIfStale } from "../readGuard";
import type { WorkoutClient, WorkoutUpdate } from "../workoutClient";
import { changedGroups, daysBack } from "./changeTime";

/** A live Change Time's own key: it never disables Done (edit) or a set write (live). */
export const CHANGE_TIME_LIVE_KEY = ["workouts", "retime"] as const;

/**
 * Where the sheet saves. The caller passes the client and the cache key, so this module never names
 * the live workout's key (Spec 18.0 AC46): the live screen passes `active`, the edit screen `detail(id)`.
 */
export interface ChangeTimeTarget {
  readonly where: "live" | "edit";
  readonly client: WorkoutClient;
  readonly cacheKey: readonly unknown[];
}

export interface ChangeTimeVars {
  readonly workout: WorkoutDetail;
  readonly patch: WorkoutUpdate;
}

/**
 * Spec 18.0 §6.5 (AC35, AC40–AC43): online-only, never queued, never retried; the cache changes only
 * in the hook-level `onSuccess`, from the response. The response's `endedAt` decides: a live workout
 * is merged and nothing else changes (it has no History row); a finished one also refreshes History,
 * Progress and records. A live save answered with a finished workout (finished on another device) is
 * not merged into the live key: that key is re-read, and the screen's gone path takes over.
 */
export function useChangeTime(target: ChangeTimeTarget): UseMutationResult<UpdatedWorkout, Error, ChangeTimeVars> {
  const queryClient = useQueryClient();
  const { where, client, cacheKey } = target;
  return useMutation({
    mutationKey: where === "edit" ? EDIT_MUTATION_KEY : CHANGE_TIME_LIVE_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: ({ workout, patch }) => client.updateWorkout(workout.id, patch),
    // As the edit hooks (#154): a read in flight, or one started while the save is pending, may answer from
    // before it; the key is read once more when the save settles.
    onMutate: () => guardReads(queryClient, cacheKey),
    onSettled: (_data, _error, _vars, guard) => rereadIfStale(queryClient, cacheKey, guard),
    onSuccess: (updated, { workout, patch }, guard) => {
      track("workout_retimed", {
        where,
        changed: changedGroups(patch),
        ...(patch.startedAt !== undefined ? { daysBack: daysBack(new Date(), updated.startedAt) } : {}),
      });
      const merge = () =>
        queryClient.setQueryData<WorkoutDetail>(cacheKey, (d) => (d?.id === workout.id ? mergeWorkout(d, updated) : d));
      if (updated.endedAt === null) {
        merge();
        return;
      }
      if (where === "edit") {
        merge();
        applyEditedCaches(queryClient);
        return;
      }
      applyEditedCaches(queryClient);
      void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workout.id) });
      guard?.finish(); // this re-read follows the save, so it replaces the guard's
      return queryClient.invalidateQueries({ queryKey: cacheKey });
    },
  });
}
