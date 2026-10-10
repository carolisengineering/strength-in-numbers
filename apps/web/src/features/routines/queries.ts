import { createContext, useContext } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { Routine } from "@sin/core";
import { ApiError } from "../../api";
import type { RoutineClient } from "./routineClient";

export const ROUTINE_KEYS = {
  all: ["routines"] as const,
  list: ["routines", "list"] as const,
  detail: (id: string) => ["routines", "detail", id] as const,
};

/** The seam tests inject a fake through (Spec 08.1 D4's pattern). */
export const RoutineClientContext = createContext<RoutineClient | null>(null);

export function useRoutineClient(): RoutineClient {
  const client = useContext(RoutineClientContext);
  if (client === null) throw new Error("useRoutineClient() must be used inside <RoutineClientProvider>");
  return client;
}

/**
 * Every routine, in the server's order (Spec 10.0 AC12, D10). `networkMode: "always"`: offline fails as
 * a `network` error instead of pausing (D11). Routines change only from this device in v1, so no focus
 * refetch. `retry: false`: the notice's Retry is the retry.
 */
export function useRoutines(): UseQueryResult<Routine[]> {
  const client = useRoutineClient();
  return useQuery({
    queryKey: ROUTINE_KEYS.list,
    queryFn: () => client.list(),
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
  });
}

export type RoutineLookup =
  | { readonly status: "pending" }
  | { readonly status: "found"; readonly routine: Routine }
  | { readonly status: "not-found" }
  | { readonly status: "error"; readonly error: unknown; readonly retry: () => void };

/**
 * One routine: from the list cache when it holds it, else `GET /v1/routines/{id}` (a deep link, or a
 * routine created on another device). `suspend` stops the fallback — the preview passes it while a
 * delete is in flight or done, so the vanished id is never re-fetched (§6.4).
 */
export function useRoutine(id: string, options: { suspend?: boolean } = {}): RoutineLookup {
  const client = useRoutineClient();
  const list = useRoutines();
  const fromList = list.data?.find((r) => r.id === id);
  const detail = useQuery({
    queryKey: ROUTINE_KEYS.detail(id),
    queryFn: () => client.get(id),
    enabled: !options.suspend && !list.isPending && fromList === undefined,
    retry: false,
    networkMode: "always",
  });
  if (fromList) return { status: "found", routine: fromList };
  if (detail.data) return { status: "found", routine: detail.data };
  if (detail.isError) {
    if (detail.error instanceof ApiError && detail.error.status === 404) return { status: "not-found" };
    return { status: "error", error: detail.error, retry: () => void detail.refetch() };
  }
  return { status: "pending" };
}
