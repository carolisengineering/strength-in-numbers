import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Routine } from "@sin/core";
import { ApiError } from "../../api";
import { WORKOUT_KEYS } from "../workouts/queries";
import { isOneOff } from "./oneOff";
import { ROUTINE_KEYS, useRoutineClient } from "./queries";
import type { RoutineWriteInput } from "./validateDraft";

/**
 * Routine writes (Spec 10.0 AC12). Cache writes live in hook-level `onSuccess` (06.1's rule — they run
 * even if the calling screen unmounted); navigation stays at the call site. `networkMode: "always"`:
 * offline fails at once with a message instead of pausing (D11).
 */

/**
 * The server's order (Spec 09.3 AC3): one-offs first, newest created first; then lowercase name, then id
 * (O7: non-ASCII may differ until the next refetch, and so may a sub-millisecond `createdAt` tie, 10.5 §6.2).
 */
export function sortRoutines(list: readonly Routine[]): Routine[] {
  return [...list].sort((x, y) => {
    const xOneOff = isOneOff(x);
    if (xOneOff !== isOneOff(y)) return xOneOff ? -1 : 1;
    if (xOneOff) {
      const byCreated = Date.parse(y.createdAt) - Date.parse(x.createdAt);
      if (byCreated !== 0) return byCreated;
    }
    const a = x.name.toLowerCase();
    const b = y.name.toLowerCase();
    if (a !== b) return a < b ? -1 : 1;
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
  });
}

function writeSaved(queryClient: QueryClient, saved: Routine): void {
  queryClient.setQueryData(ROUTINE_KEYS.detail(saved.id), saved);
  // Returning `undefined` leaves an uncached list uncached: the next `useRoutines` fetches it.
  queryClient.setQueryData<Routine[]>(ROUTINE_KEYS.list, (old) =>
    old === undefined ? undefined : sortRoutines([...old.filter((r) => r.id !== saved.id), saved]),
  );
}

/** Spec 10.5: `oneOff` is set only by the import editor's Save (`EditorStart.oneOff`). */
export function useCreateRoutine(): UseMutationResult<Routine, Error, { body: RoutineWriteInput; oneOff?: true }> {
  const client = useRoutineClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ body, oneOff }) => client.create(body, oneOff ? { oneOff } : undefined),
    onSuccess: (saved) => writeSaved(queryClient, saved),
  });
}

export function useReplaceRoutine(): UseMutationResult<Routine, Error, { id: string; body: RoutineWriteInput }> {
  const client = useRoutineClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: ({ id, body }) => client.replace(id, body),
    onSuccess: (saved) => writeSaved(queryClient, saved),
  });
}

export function useDeleteRoutine(): UseMutationResult<void, Error, string> {
  const client = useRoutineClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: async (id) => {
      try {
        await client.remove(id);
      } catch (error) {
        // A repeat of an applied delete answers 404: already gone is success (AC24).
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    },
    onSuccess: (_, id) => {
      queryClient.removeQueries({ queryKey: ROUTINE_KEYS.detail(id), exact: true });
      queryClient.setQueryData<Routine[]>(ROUTINE_KEYS.list, (old) => old?.filter((r) => r.id !== id));
    },
  });
}

/**
 * Spec 10.5 AC8 — Keep as a routine. The caches are patched in hook-level `onSuccess` (they land even if the
 * preview unmounted), then revalidated so the server's `updatedAt` / `ETag` replace the patch. The active
 * workout is revalidated too: a live workout started from this routine must stop warning that it leaves.
 * Unlike delete, a `404` is not success (the routine was removed by a finish; "Kept" would be untrue).
 */
export function useKeepRoutine(): UseMutationResult<void, Error, string> {
  const client = useRoutineClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: (id) => client.keep(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<Routine>(ROUTINE_KEYS.detail(id), (old) => (old === undefined ? undefined : { ...old, oneOffUntil: null }));
      queryClient.setQueryData<Routine[]>(ROUTINE_KEYS.list, (old) =>
        old === undefined ? undefined : sortRoutines(old.map((r) => (r.id === id ? { ...r, oneOffUntil: null } : r))),
      );
      void queryClient.invalidateQueries({ queryKey: ROUTINE_KEYS.all });
      void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
    onError: (error, id) => {
      if (!(error instanceof ApiError && error.status === 404)) return;
      queryClient.removeQueries({ queryKey: ROUTINE_KEYS.detail(id), exact: true });
      void queryClient.invalidateQueries({ queryKey: ROUTINE_KEYS.list });
    },
  });
}
