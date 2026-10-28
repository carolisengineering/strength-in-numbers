import type { HevyUserInfo } from "@sin/core";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { useSession } from "../../auth/useSession";
import { HEVY_KEYS } from "./keys";
import { useHevyClient } from "./useHevyClient";

/**
 * Spec 20.0 AC5: who the stored key signs in as, after a reload (only the key is stored). Removed on every key save
 * or remove; never retried, so a key Hevy now refuses shows its sentence at once.
 */
export function useHevyUser(): UseQueryResult<HevyUserInfo> {
  const client = useHevyClient();
  const userId = useSession().user?.id ?? null;
  return useQuery({
    queryKey: HEVY_KEYS.user(userId),
    queryFn: ({ signal }) => client!.userInfo(signal),
    enabled: client !== null,
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    retry: false,
  });
}
