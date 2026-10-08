import { useMemo, type ReactNode } from "react";
import { useApi } from "../../auth/useApi";
import { createProgressClient } from "./progressClient";
import { ProgressClientContext } from "./queries";

/** Supplies the progress client (Spec 08.1 D4). Tests inject fakes through the context. */
export function ProgressClientProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const client = useMemo(() => createProgressClient(api), [api]);
  return <ProgressClientContext.Provider value={client}>{children}</ProgressClientContext.Provider>;
}
