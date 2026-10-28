import type { ReactNode } from "react";

import { NotFound } from "../../screens/NotFound";
import { Spinner } from "../../ui/Spinner";
import { useHevyEnabled } from "./useHevyStatus";

/**
 * Spec 20.0 AC1: the gate on every Hevy path. For anyone but the owner it is the ordinary not-found screen; while
 * the status is pending it is a spinner, so a direct visit never flashes the Hevy screen first.
 */
export function HevyRoute({ children }: { children: ReactNode }) {
  const enabled = useHevyEnabled();
  if (enabled === "pending") return <Spinner label="Loading…" />;
  if (enabled === "off") return <NotFound />;
  return <>{children}</>;
}
