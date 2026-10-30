import { HEVY_LINK_CLAIM_TTL_S, HevyLinkStateSchema, type HevyLinkState } from "@sin/core";
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

/**
 * Minor 260: a claim seen as "sending" was made before it was read, so one claim window after that read it has surely
 * ended (or been renewed): read again then. The second is a margin for the two clocks.
 */
export const SENDING_RECHECK_MS = (HEVY_LINK_CLAIM_TTL_S + 1) * 1000;

/**
 * AC1 / AC2: only the owner (status `200`) ever reads it; for anyone else the only request is the status. While it
 * reads "sending" (another device's claim), it is read again once that claim's window has passed, and on focus.
 */
export function useHevyLink(workoutId: string, { enabled = true }: { enabled?: boolean } = {}): UseQueryResult<HevyLinkState> {
  const api = useApi();
  const owner = useHevyEnabled() === "on";
  return useQuery({
    ...hevyLinkQuery(api, workoutId),
    enabled: enabled && owner,
    refetchInterval: (query) => (query.state.data?.state === "sending" ? SENDING_RECHECK_MS : false),
    refetchOnWindowFocus: (query) => query.state.data?.state === "sending",
  });
}
