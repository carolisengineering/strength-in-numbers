import { hashKey, type QueryClient } from "@tanstack/react-query";
import type { PersonalRecord } from "@sin/core";
import { HISTORY_KEYS } from "../history/queries";
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
}

/** The cache effects of deleting a finished workout: its records go; another workout may regain one. */
export function applyDeletedCaches(queryClient: QueryClient, workoutId: string): void {
  const own = RECORDS_KEYS.forWorkout(workoutId);
  queryClient.removeQueries({ queryKey: own, exact: true });
  invalidateOthers(queryClient, own);
}

function invalidateOthers(queryClient: QueryClient, own: readonly unknown[]): void {
  const ownHash = hashKey(own);
  void queryClient.invalidateQueries({ queryKey: HISTORY_KEYS.all });
  void queryClient.invalidateQueries({ queryKey: RECORDS_KEYS.all, predicate: (q) => q.queryHash !== ownHash });
}
