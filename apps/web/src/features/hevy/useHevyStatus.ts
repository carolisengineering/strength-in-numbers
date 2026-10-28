import { HevyStatusSchema, type HevyStatus } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";
import { HEVY_KEYS } from "./keys";

/**
 * Spec 20.0 AC1: `GET /v1/hevy/status` (Spec 19.0). Only an account on `HEVY_ENABLED_USER_IDS` gets a `200`; anyone
 * else gets the unknown-route `404`, so the status is also the gate for every Hevy screen. No retry: a 404 is the
 * expected answer for everyone but the owner.
 */
export function useHevyStatus(): UseQueryResult<HevyStatus> {
  const api = useApi();
  return useQuery({
    queryKey: HEVY_KEYS.status,
    queryFn: () => api.get("/v1/hevy/status", HevyStatusSchema),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

/** `on` only on a successful status; any error (the 404, a network failure) is `off`. */
export function useHevyEnabled(): "pending" | "on" | "off" {
  const status = useHevyStatus();
  if (status.isPending) return "pending";
  return status.isSuccess ? "on" : "off";
}
