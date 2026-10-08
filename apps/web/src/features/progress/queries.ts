import { createContext, useContext } from "react";
import { keepPreviousData, useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { ProgressSeries } from "@sin/core";
import { todayLocal } from "./dates";
import type { ProgressClient } from "./progressClient";
import { rangeStart, type Range } from "./range";

/** `["progress"]` prefixes every series, so 08.0's finish/delete helpers invalidate them all (AC8). */
export const PROGRESS_KEYS = {
  all: ["progress"] as const,
  series: (exerciseId: string, range: Range) => ["progress", exerciseId, range] as const,
};

export const ProgressClientContext = createContext<ProgressClient | null>(null);

export function useProgressClient(): ProgressClient {
  const client = useContext(ProgressClientContext);
  if (client === null) throw new Error("useProgressClient() must be used inside <ProgressClientProvider>");
  return client;
}

/** "Today" for range windows — a test seam; production reads the device's local date (§6.1, D7). */
export const ProgressClockContext = createContext<() => string>(() => todayLocal());

/**
 * One exercise's series for one range. `from` is computed inside `queryFn` (fetch time), so the date is
 * not in the key; `keepPreviousData` keeps the last range on screen while a new one loads (D8).
 */
export function useSeries(exerciseId: string, range: Range): UseQueryResult<ProgressSeries> {
  const client = useProgressClient();
  const today = useContext(ProgressClockContext);
  return useQuery({
    queryKey: PROGRESS_KEYS.series(exerciseId, range),
    queryFn: () => {
      const from = rangeStart(today(), range);
      return client.getSeries(exerciseId, from === undefined ? {} : { from });
    },
    placeholderData: keepPreviousData,
    retry: false,
  });
}
