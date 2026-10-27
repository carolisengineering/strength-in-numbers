import { ExerciseUsageResponseSchema, type ExerciseUsageResponse } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";
import { EXERCISE_KEYS } from "./keys";

type UsageRows = ExerciseUsageResponse["exercises"];

const toMap = (rows: UsageRows): ReadonlyMap<string, string> =>
  new Map(rows.map((r) => [r.rootId, r.lastLoggedOn]));

/**
 * `GET /v1/exercises/usage` (Spec 18.2 AC7): lineage root → last-logged local date. The map is built
 * in `select`, so structural sharing keeps the array (and the map's inputs) stable across `304`s.
 * `networkMode: "always"`: offline fails as a `network` error instead of pausing (AC15). Memory only;
 * nothing is stored.
 */
export function useExerciseUsage(): UseQueryResult<ReadonlyMap<string, string>> {
  const api = useApi();
  return useQuery({
    queryKey: EXERCISE_KEYS.usage,
    queryFn: async () => (await api.get("/v1/exercises/usage", ExerciseUsageResponseSchema)).exercises,
    select: toMap,
    staleTime: 0,
    retry: false,
    networkMode: "always",
  });
}
