// apps/web/src/features/routines/useRoutineMutations.ts
import { useMutation, useQueryClient, type QueryClient, type UseMutationResult } from "@tanstack/react-query";
import type { Routine } from "@sin/core";
import { ApiError } from "../../api";
import { ROUTINE_KEYS, useRoutineClient } from "./queries";
import type { RoutineWriteInput } from "./validateDraft";

/**
 * Routine writes (Spec 10.0 AC12). Cache writes live in hook-level `onSuccess` (06.1's rule — they run
 * even if the calling screen unmounted); navigation stays at the call site. `networkMode: "always"`:
 * offline fails at once with a message instead of pausing (D11).
 */

/** The server's order: lowercase name, then id (O7: non-ASCII may differ until the next refetch). */
export function sortRoutines(list: readonly Routine[]): Routine[] {
  return [...list].sort((x, y) => {
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

export function useCreateRoutine(): UseMutationResult<Routine, Error, RoutineWriteInput> {
  const client = useRoutineClient();
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: (body) => client.create(body),
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
