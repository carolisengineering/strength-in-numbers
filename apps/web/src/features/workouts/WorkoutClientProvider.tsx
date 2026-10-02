import { useMemo, type ReactNode } from "react";
import { useApi } from "../../auth/useApi";
import { WorkoutClientContext } from "./queries";
import { createWorkoutClient } from "./workoutClient";

/** Supplies the REST `WorkoutClient`. Spec 06.2 swaps the client built here for a queue-backed one. */
export function WorkoutClientProvider({ children }: { children: ReactNode }) {
  const api = useApi();
  const client = useMemo(() => createWorkoutClient(api), [api]);
  return <WorkoutClientContext.Provider value={client}>{children}</WorkoutClientContext.Provider>;
}
