import { HevyStatusSchema, type HevyStatus } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { ApiError } from "../../api";
import { useApi } from "../../auth/useApi";
import { useSession } from "../../auth/useSession";
import { HEVY_KEYS } from "./keys";

/**
 * Spec 20.0 AC1: `GET /v1/hevy/status` (Spec 19.0). Only an account on `HEVY_ENABLED_USER_IDS` gets a `200`; anyone
 * else gets the unknown-route `404`, so the status is also the gate for every Hevy screen. No retry: a 404 is the
 * expected answer for everyone but the owner. `networkMode: "always"`, so an offline visit fails at once (and says
 * so) instead of pausing in pending.
 */
export function useHevyStatus(): UseQueryResult<HevyStatus> {
  const api = useApi();
  const userId = useSession().user?.id ?? null;
  return useQuery({
    queryKey: HEVY_KEYS.status(userId),
    queryFn: () => api.get("/v1/hevy/status", HevyStatusSchema),
    retry: false,
    staleTime: 5 * 60_000,
    networkMode: "always",
  });
}

/**
 * `on` once a status has succeeded, even if a later background refetch fails (TanStack keeps the data beside the
 * error), so a network blip never turns the owner's Hevy screen into "not found". With no data: a `404` (or any
 * answer the server gave) is `off`; a failure to reach the server is `unreachable`.
 */
export function useHevyEnabled(): "pending" | "on" | "off" | "unreachable" {
  const status = useHevyStatus();
  if (status.data !== undefined) return "on";
  if (status.isPending) return "pending";
  return status.error instanceof ApiError && status.error.isNetworkError ? "unreachable" : "off";
}
