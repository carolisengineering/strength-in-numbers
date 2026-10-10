// apps/web/src/features/routines/RoutineClientProvider.tsx
import { useMemo, type ReactNode } from "react";
import { useApi } from "../../auth/useApi";
import { RoutineClientContext } from "./queries";
import { createRoutineClient } from "./routineClient";

/** Supplies the REST routine client (Spec 10.0). Tests inject fakes through the context. */
export function RoutineClientProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const client = useMemo(() => createRoutineClient(api), [api]);
  return <RoutineClientContext.Provider value={client}>{children}</RoutineClientContext.Provider>;
}
