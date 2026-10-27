import type { HevyPair } from "./types.js";

/**
 * Spec 19.0 AC15: every exercise with at least one pair has exactly one `exportAs` pair: the first marked one in the
 * given order, else the first pair. A pair that is not `role: "exercise"` is never `exportAs`. Idempotent; the input
 * is not mutated (a changed pair is a copy).
 */
export function normalizeExportAs<P extends Pick<HevyPair, "role" | "exerciseId" | "exportAs">>(pairs: readonly P[]): P[] {
  const chosen = new Map<string, number>();
  pairs.forEach((p, i) => {
    if (p.role !== "exercise" || p.exerciseId === null) return;
    const current = chosen.get(p.exerciseId);
    if (current === undefined || (p.exportAs && !pairs[current]!.exportAs)) chosen.set(p.exerciseId, i);
  });
  return pairs.map((p, i) => {
    const exportAs = p.role === "exercise" && p.exerciseId !== null && chosen.get(p.exerciseId) === i;
    return p.exportAs === exportAs ? p : { ...p, exportAs };
  });
}
