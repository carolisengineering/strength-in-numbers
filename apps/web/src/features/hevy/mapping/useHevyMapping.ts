import { HevyMappingSchema, type HevyMapping } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ApiClient } from "../../../api/client";
import { useApi } from "../../../auth/useApi";
import { HEVY_KEYS } from "../keys";

/**
 * Spec 20.0 AC17: the stored mapping's query options — the hook and a send's `fetchQuery` (Spec 20.2) share them.
 * Always re-read on open (`staleTime: 0`); a failure shows, never retried.
 */
export function hevyMappingQuery(api: Pick<ApiClient, "get">) {
  return {
    queryKey: HEVY_KEYS.mapping,
    queryFn: () => api.get("/v1/hevy/mapping", HevyMappingSchema),
    staleTime: 0,
    retry: false,
  };
}

export function useHevyMapping(): UseQueryResult<HevyMapping> {
  const api = useApi();
  return useQuery(hevyMappingQuery(api));
}
