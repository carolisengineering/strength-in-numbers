import type { UseQueryResult } from "@tanstack/react-query";
import { useMemo } from "react";

import { useCatalog } from "../catalog/useCatalog";
import { buildExerciseRows, type ExerciseRow } from "./exerciseRows";
import { useExerciseUsage } from "./usage";

const NO_USAGE: ReadonlyMap<string, string> = new Map();

export interface ExerciseList {
  /** Every exercise the lifter can pick, in list order (Spec 18.2 AC8, AC9). */
  rows: ExerciseRow[];
  usage: UseQueryResult<ReadonlyMap<string, string>>;
  /** The catalog has rows, or its first sync has finished: an empty `rows` then really means none. */
  catalogReady: boolean;
}

/**
 * All exercises' list model, shared by the list (`AllExercises`) and, at desktop widths, the panes layout and its
 * index (Spec 17.12 AC21). `enabled: false` reads nothing new: it only observes the usage cache.
 */
export function useExerciseList({ enabled = true }: { enabled?: boolean } = {}): ExerciseList {
  const { visible, state } = useCatalog();
  const usage = useExerciseUsage({ enabled });
  const rows = useMemo(() => buildExerciseRows(visible, usage.data ?? NO_USAGE), [visible, usage.data]);
  const catalogReady = visible.length > 0 || (state.lastRefreshAt !== null && state.status !== "loading");
  return { rows, usage, catalogReady };
}
