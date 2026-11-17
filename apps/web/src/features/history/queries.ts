import { createContext, useContext } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import type { WorkoutHistoryResponse, WorkoutSummary } from "@sin/core";
import { ApiError } from "../../api";
import type { HistoryClient } from "./historyClient";

/** `["history"]` prefixes every history query, so one invalidation covers them (Spec 08.0 §6.1). */
export const HISTORY_KEYS = {
  all: ["history"] as const,
  list: ["history", "list"] as const,
};

export const HistoryClientContext = createContext<HistoryClient | null>(null);

export function useHistoryClient(): HistoryClient {
  const client = useContext(HistoryClientContext);
  if (client === null) throw new Error("useHistoryClient() must be used inside <HistoryRecordsClientProvider>");
  return client;
}

/**
 * `GET /v1/workouts`, page by page (Spec 08.0 §6.3). Page 1 sends no cursor; each next page sends the
 * previous page's `next`, opaque; `null` ends the list. No own `staleTime` (D9). `enabled: false` reads the
 * cache without fetching (Spec 17.12: History's layout route below 64rem).
 */
export function useHistoryList({ enabled = true }: { enabled?: boolean } = {}) {
  const client = useHistoryClient();
  return useInfiniteQuery({
    queryKey: HISTORY_KEYS.list,
    enabled,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => client.listWorkouts(pageParam === undefined ? {} : { cursor: pageParam }),
    getNextPageParam: (last) => last.next ?? undefined,
    retry: false,
  });
}

/**
 * Pages → rows, first occurrence of an id wins. Keyset paging should never repeat a row, but an
 * invalidation refetch can straddle a concurrent finish, and a duplicate React key is a rendering bug.
 */
export function flattenHistory(pages: readonly WorkoutHistoryResponse[]): WorkoutSummary[] {
  const rows = new Map<string, WorkoutSummary>();
  for (const page of pages) for (const row of page.items) if (!rows.has(row.id)) rows.set(row.id, row);
  return [...rows.values()];
}

/**
 * A `422` on `cursor` can only mean a cursor format older than the deployed API (the client never
 * builds one): the lifter cannot fix it by retrying, so the list restarts from page 1 (Spec 08.0 D13).
 */
export function isStaleCursor(error: unknown): boolean {
  return error instanceof ApiError && error.status === 422 && error.errors.some((e) => e.path === "cursor");
}
