import { HevyLinkStateSchema, type HevyLinkState } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { ApiClient } from "../../../api/client";
import { useApi } from "../../../auth/useApi";
import { HEVY_SEND_KEYS } from "../keys";
import { useHevyEnabled } from "../useHevyStatus";

/**
 * Spec 20.2 AC2: a workout's Hevy link. Read fresh on every mount (`staleTime: 0`, `refetchOnMount: "always"`) and
 * never retried (a `404` or a network error hides the section). `networkMode: "always"`, so offline it fails at once.
 */
export function hevyLinkQuery(api: Pick<ApiClient, "get">, workoutId: string) {
  return {
    queryKey: HEVY_SEND_KEYS.link(workoutId),
    queryFn: () => api.get(`/v1/workouts/${workoutId}/hevy-link`, HevyLinkStateSchema),
    staleTime: 0,
    refetchOnMount: "always" as const,
    retry: false,
    networkMode: "always" as const,
  };
}

/** AC1 / AC2: only the owner (status `200`) ever reads it; for anyone else the only request is the status. */
export function useHevyLink(workoutId: string, { enabled = true }: { enabled?: boolean } = {}): UseQueryResult<HevyLinkState> {
  const api = useApi();
  const owner = useHevyEnabled() === "on";
  return useQuery({ ...hevyLinkQuery(api, workoutId), enabled: enabled && owner });
}
