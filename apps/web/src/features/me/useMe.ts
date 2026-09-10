import { MeSchema, type Me } from "@sin/core";
import { useQuery } from "@tanstack/react-query";

import { useApi } from "../../auth/useApi";

/**
 * Shared query key. Every `me` consumer (`ProtectedLayout`, `AppShell`,
 * `useSession`, and the Profile mutation's cache write) uses it so TanStack Query dedupes concurrent mounts
 * to a single `GET /v1/me` (Spec 04.0 §6.5, AC9).
 */
export const ME_QUERY_KEY = ["me"] as const;

/**
 * `GET /v1/me` (Spec 04.0 §6.4 / §6.5). The body is `MeSchema.parse`d by the API
 * client (dev-hard / prod-warn per Q15). `retry: false` — AC10's retry is a user
 * button (`RetryScreen`), not TanStack auto-retry, which would also stall the
 * network-error path.
 */
export function useMe() {
  const api = useApi();

  return useQuery<Me>({
    queryKey: ME_QUERY_KEY,
    queryFn: () => api.get("/v1/me", MeSchema),
    retry: false,
    // The `me` row only changes via `PATCH /v1/me` (Spec 04.1 §6.5), whose
    // mutation writes the response straight into this key with
    // `setQueryData` — it never invalidates, so there is no refetch.
    // Never-stale keeps every consumer (`ProtectedLayout`, `AppShell`,
    // `useSession`) on the one request per session — AC9's "exactly one"
    // guarantee (§6.5).
    staleTime: Number.POSITIVE_INFINITY,
  });
}
