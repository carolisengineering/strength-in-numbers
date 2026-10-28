import { useMemo } from "react";

import { useSession } from "../../auth/useSession";
import type { HevyClient } from "./client/hevyClient";
import { hevyKeyStore } from "./keyStore";
import { hevyClientFor } from "./sharedClient";
import { useHevyKey } from "./useHevyKey";

export { setRetrySleepForTests, setSharedPacerForTests } from "./sharedClient";

/** Spec 20.0: the signed-in user's Hevy client, or `null` while there is no key. A Replace takes effect on the next request. */
export function useHevyClient(): HevyClient | null {
  const userId = useSession().user?.id ?? null;
  const { hasKey } = useHevyKey();
  const client = useMemo(() => (userId === null ? null : hevyClientFor(() => hevyKeyStore.get(userId))), [userId]);
  return hasKey ? client : null;
}
