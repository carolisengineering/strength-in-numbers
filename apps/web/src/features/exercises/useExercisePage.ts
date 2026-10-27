import { useCatalog } from "../catalog/useCatalog";
import { resolveExercise, type Resolution } from "./resolveExercise";

/**
 * The exercise page's resolution (Spec 18.2 AC19). It reads the raw store rows, because a fork origin
 * (hidden from `visible`) must still resolve to its copy.
 */
export function useExercisePage(id: string): Resolution {
  const { state } = useCatalog();
  return resolveExercise(state.rows, id, {
    synced: state.lastRefreshAt !== null,
    failed: state.status === "error",
  });
}
