import { HevyMappingSchema, type HevyMapping } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useApi } from "../../../auth/useApi";
import { HEVY_KEYS } from "../keys";

/** Spec 20.0 AC17: the stored mapping. Always re-read on open (`staleTime: 0`); a failure shows, never retried. */
export function useHevyMapping(): UseQueryResult<HevyMapping> {
  const api = useApi();
  return useQuery({
    queryKey: HEVY_KEYS.mapping,
    queryFn: () => api.get("/v1/hevy/mapping", HevyMappingSchema),
    staleTime: 0,
    retry: false,
  });
}
