import { useMemo } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkoutSection } from "@sin/core";
import { withSection, withSectionCleared } from "../cache";
import { isNetworkFailure } from "../outbox/classify";
import { useEditWorkoutClient, WORKOUT_KEYS } from "../queries";
import { rereadUntilLanded } from "../readGuard";
import { reportUnexpected } from "../reportUnexpected";
import type { ResultWrite } from "../result/resultDraft";
import { isTimerMismatch } from "../result/timerMismatch";
import type { ResultWriter } from "../result/useResultActions";
import { EDIT_MUTATION_KEY, editSucceeded, writeDetail } from "./useEditMutations";

type Outcome = { ok: true } | { ok: false; failedAt: number; error: unknown };

/**
 * Spec 10.7 AC42 — the edit screen's Log result writer: the Save's writes on the plain REST client, one request
 * after another (`EDIT_MUTATION_KEY`, so Done waits; `networkMode: "always"`, `retry: false`), stopping at the first
 * failure. Each success writes the returned section (or the clear) into the cached detail; a failure after a success
 * re-reads it. `editSucceeded` runs **once** per Save when anything landed, so `workout_edit` is sent once. Never
 * the outbox, drafts or rest store.
 */
export function useEditResultMutations(workoutId: string): ResultWriter {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationKey: EDIT_MUTATION_KEY,
    networkMode: "always",
    retry: false,
    mutationFn: async ({ section, writes }: { section: WorkoutSection; writes: readonly ResultWrite[] }): Promise<Outcome> => {
      let landed = 0;
      try {
        for (const write of writes) {
          if (write.kind === "round") {
            if (write.seconds !== null) {
              const next = await client.putRoundTime(section.id, write.round, write.seconds);
              writeDetail(queryClient, workoutId, (d) => withSection(d, next));
            } else {
              await client.deleteRoundTime(section.id, write.round);
              writeDetail(queryClient, workoutId, (d) => withSectionCleared(d, section.id, { round: write.round }));
            }
          } else if (write.body !== null) {
            const next = await client.putResult(section.id, write.body);
            writeDetail(queryClient, workoutId, (d) => withSection(d, next));
          } else {
            await client.deleteResult(section.id);
            writeDetail(queryClient, workoutId, (d) => withSectionCleared(d, section.id, "result"));
          }
          landed += 1;
        }
        return { ok: true };
      } catch (error) {
        if (!isNetworkFailure(error) && !isTimerMismatch(error)) reportUnexpected("log-result-edit", error);
        if (landed > 0) await rereadUntilLanded(queryClient, WORKOUT_KEYS.detail(workoutId));
        return { ok: false, failedAt: landed, error };
      } finally {
        if (landed > 0) editSucceeded(queryClient, "section_result_changed");
      }
    },
  });
  const { mutateAsync } = mutation;
  return useMemo<ResultWriter>(() => ({ save: (section, writes) => mutateAsync({ section, writes }) }), [mutateAsync]);
}
