import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { WorkoutDetail } from "@sin/core";
import { track } from "../../../observability/track";
import { useOutbox } from "../outbox/OutboxContext";
import { project } from "../outbox/project";
import { useWorkoutClient, WORKOUT_KEYS } from "../queries";
import type { ResultWriter } from "./useResultActions";

/**
 * Spec 10.7 AC31, AC34, AC43 — the live screen's Log result writer: each write goes through the queued client (an
 * outbox op, resolved at once), in the Save's order; then the active workout is re-projected so the heading shows
 * the queued values, and `section_result_logged { format }` is sent once per Save. The one module in `result/` that
 * names the live client or the active workout.
 */
export function useResultMutations(): ResultWriter {
  const client = useWorkoutClient();
  const outbox = useOutbox();
  const queryClient = useQueryClient();
  return useMemo<ResultWriter>(
    () => ({
      async save(section, writes) {
        for (let i = 0; i < writes.length; i += 1) {
          const write = writes[i]!;
          try {
            if (write.kind === "round") {
              if (write.seconds !== null) await client.putRoundTime(section.id, write.round, write.seconds);
              else await client.deleteRoundTime(section.id, write.round);
            } else if (write.body !== null) await client.putResult(section.id, write.body);
            else await client.deleteResult(section.id);
          } catch (error) {
            return { ok: false, failedAt: i, error };
          }
        }
        if (outbox) queryClient.setQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active, (d) => (d ? project(d, outbox.getState()).workout : d));
        if (section.timer !== null) track("section_result_logged", { format: section.timer.format });
        return { ok: true };
      },
    }),
    [client, outbox, queryClient],
  );
}
