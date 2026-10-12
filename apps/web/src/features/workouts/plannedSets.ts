import type { PlannedSet } from "@sin/core";
import { SET_TYPE_LABELS } from "./format";

/**
 * Spec 10.2 AC20, D2: progress through a plan is POSITIONAL — the n-th set on the card consumes the n-th row,
 * whatever its type or values. `loggedCount` is the number of sets in the list the card renders (queued and
 * failed rows included, 06.2); never a `setNumber`, which is append-only and not dense (DESIGN §4.4).
 */
export type NextPlanned =
  | { readonly kind: "planned"; readonly row: PlannedSet; readonly index: number; readonly total: number }
  | { readonly kind: "extra" }
  | { readonly kind: "none" };

export function nextPlanned(plannedSets: readonly PlannedSet[], loggedCount: number): NextPlanned {
  const total = plannedSets.length;
  if (total === 0) return { kind: "none" };
  const row = plannedSets[loggedCount];
  return row === undefined ? { kind: "extra" } : { kind: "planned", row, index: loggedCount, total };
}

/** "Set 3 of 4", "Set 1 of 5 · Warm-up", "Extra set"; with no plan exactly today's "Set {n + 1}" (AC21, AC27). */
export function setLabel(plannedSets: readonly PlannedSet[], loggedCount: number): string {
  const next = nextPlanned(plannedSets, loggedCount);
  switch (next.kind) {
    case "none":
      return `Set ${loggedCount + 1}`;
    case "extra":
      return "Extra set";
    case "planned": {
      const head = `Set ${next.index + 1} of ${next.total}`;
      return next.row.setType === "working" ? head : `${head} · ${SET_TYPE_LABELS[next.row.setType]}`;
    }
  }
}
