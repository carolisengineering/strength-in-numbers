import { hashKey, type QueryClient } from "@tanstack/react-query";
import type { PersonalRecord } from "@sin/core";
import { HISTORY_KEYS } from "../history/queries";
import { PROGRESS_KEYS } from "../progress/queries";
import { ROUTINE_KEYS } from "../routines/queries";
import { RECORDS_KEYS } from "./queries";

/**
 * The cache effects of a finish (Spec 08.0 §6.1, D7). Called from `useFinishWorkout`'s hook-level
 * `onSuccess` and from `ActiveSession.confirmAlreadyFinished` — any future path that finishes a
 * workout must call it too.
 *
 * `newRecords` from the finish response seeds the summary's entry (no spinner, no GET). `null` (the
 * recovery path: the response was lost) removes it, so the summary fetches `?workoutId=` instead.
 * Every *other* records query is invalidated — a finish can take a record from an older workout —
 * but not the seeded one: a bare prefix invalidation would mark it stale and refetch it at once.
 */
export function applyFinishedCaches(
  queryClient: QueryClient,
  workoutId: string,
  newRecords: readonly PersonalRecord[] | null,
): void {
  const own = RECORDS_KEYS.forWorkout(workoutId);
  if (newRecords) queryClient.setQueryData<PersonalRecord[]>(own, [...newRecords]);
  else queryClient.removeQueries({ queryKey: own, exact: true });
  invalidateOthers(queryClient, own);
  // Spec 10.5 AC15 / D6: a finish may remove or keep a one-off routine. Always, because on the recovery
  // path the refetched detail already reads `routineIsOneOff: false`, so no flag can gate it.
  void queryClient.invalidateQueries({ queryKey: ROUTINE_KEYS.all });
}

/** The cache effects of deleting a finished workout: its records go; another workout may regain one. */
export function applyDeletedCaches(queryClient: QueryClient, workoutId: string): void {
  const own = RECORDS_KEYS.forWorkout(workoutId);
  queryClient.removeQueries({ queryKey: own, exact: true });
  invalidateOthers(queryClient, own);
}

/**
 * The cache effects of any successful write to a finished workout (Spec 18.0 AC22): History restarts
 * at page 1 (an edit can move or change rows), every progress series and records family is stale.
 * The workout's own detail is left to the caller (written from a response, or invalidated).
 */
export function applyEditedCaches(queryClient: QueryClient): void {
  void queryClient.resetQueries({ queryKey: HISTORY_KEYS.list });
  void queryClient.invalidateQueries({ queryKey: PROGRESS_KEYS.all });
  void queryClient.invalidateQueries({ queryKey: RECORDS_KEYS.all });
}

function invalidateOthers(queryClient: QueryClient, own: readonly unknown[]): void {
  const ownHash = hashKey(own);
  void queryClient.invalidateQueries({ queryKey: HISTORY_KEYS.all });
  // A finished or deleted session changes every chart it appears in (Spec 08.1 AC8).
  void queryClient.invalidateQueries({ queryKey: PROGRESS_KEYS.all });
  void queryClient.invalidateQueries({ queryKey: RECORDS_KEYS.all, predicate: (q) => q.queryHash !== ownHash });
}
