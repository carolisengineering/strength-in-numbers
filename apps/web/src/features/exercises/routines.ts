import { ExerciseRoutinesResponseSchema, type ExerciseRoutineRef } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";
import { EXERCISE_KEYS } from "./keys";

/**
 * `GET /v1/exercises/{id}/routines` (Spec 18.2 AC46): the routines a delete would break, exact id (03.4 D13). Read
 * fresh on every opening (`staleTime: 0`, `gcTime: 0`): a stale list is the failure that matters on a destructive
 * action (§6.7). Online-only, never retried.
 */
export function useExerciseRoutines(id: string, opts: { enabled: boolean }): UseQueryResult<ExerciseRoutineRef[]> {
  const api = useApi();
  return useQuery({
    queryKey: EXERCISE_KEYS.routines(id),
    queryFn: async () => (await api.get(`/v1/exercises/${encodeURIComponent(id)}/routines`, ExerciseRoutinesResponseSchema)).routines,
    enabled: opts.enabled,
    staleTime: 0,
    gcTime: 0,
    retry: false,
    networkMode: "always",
  });
}
