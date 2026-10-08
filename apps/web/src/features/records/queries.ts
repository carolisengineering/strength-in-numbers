import { createContext, useContext } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { PersonalRecord } from "@sin/core";
import type { RecordsClient } from "./recordsClient";

/**
 * `["records"]` prefixes every records query — Spec 08.1's `{ exerciseId }` entries included — so a
 * finish or delete invalidates them all with one call (Spec 08.0 §6.1).
 */
export const RECORDS_KEYS = {
  all: ["records"] as const,
  forWorkout: (workoutId: string) => ["records", { workoutId }] as const,
  forExercise: (exerciseId: string) => ["records", { exerciseId }] as const,
};

export const RecordsClientContext = createContext<RecordsClient | null>(null);

export function useRecordsClient(): RecordsClient {
  const client = useContext(RecordsClientContext);
  if (client === null) throw new Error("useRecordsClient() must be used inside <HistoryRecordsClientProvider>");
  return client;
}

/**
 * The records a workout holds now (07.0 D18). No own `staleTime`: the app default (30 s) is what lets
 * the entry seeded from the finish response render without a refetch (Spec 08.0 D9).
 */
export function useWorkoutRecords(workoutId: string): UseQueryResult<PersonalRecord[]> {
  const client = useRecordsClient();
  return useQuery({
    queryKey: RECORDS_KEYS.forWorkout(workoutId),
    queryFn: () => client.listRecords({ workoutId }),
    retry: false,
  });
}
