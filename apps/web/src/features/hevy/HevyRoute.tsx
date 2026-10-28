import type { ReactNode } from "react";

import { NotFound } from "../../screens/NotFound";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useHevyEnabled } from "./useHevyStatus";

/**
 * Spec 20.0 AC1: the gate on every Hevy path. For anyone but the owner it is the ordinary not-found screen; while
 * the status is pending it is a spinner, so a direct visit never flashes the Hevy screen first. With no answer at
 * all (offline, AC15) it says so; the words name no feature, because the gate hides it from everyone else.
 */
export function HevyRoute({ children }: { children: ReactNode }) {
  const enabled = useHevyEnabled();
  if (enabled === "pending") return <Spinner label="Loading…" />;
  if (enabled === "unreachable") {
    return (
      <Screen title="Can't load this page">
        <p role="alert">{PAGE_UNREACHABLE}</p>
      </Screen>
    );
  }
  if (enabled === "off") return <NotFound />;
  return <>{children}</>;
}

// Plan copy.
const PAGE_UNREACHABLE = "Couldn't load this page. Check your connection and try again.";
