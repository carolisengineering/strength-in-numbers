import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { planSessionChange, type SessionOp, type SessionPatch, type SessionSlot } from "@sin/core";

import { track } from "../../observability/track";
import { WORKOUT_KEYS } from "./queries";
import { useUpdateWorkoutExercise } from "./useWorkoutMutations";
import type { WorkoutExercisePatch } from "./workoutClient";

export const NO_FREE_GROUP_MESSAGE = "This workout has too many supersets";

export type RegroupOutcome =
  | { readonly status: "done" }
  | { readonly status: "busy" }
  | { readonly status: "refused"; readonly message: string }
  /** `single`: the plan was one `position` PATCH — a plain 06.1 move, safe to offer Try again (D7). */
  | { readonly status: "failed"; readonly error: unknown; readonly single: boolean };

const bodyOf = (patch: SessionPatch): WorkoutExercisePatch =>
  "position" in patch ? { position: patch.position } : { supersetGroup: patch.supersetGroup };

/**
 * Spec 10.1 AC12–AC15, §6.3: plan a link / unlink / block move with `planSessionChange`, send the
 * PATCHes strictly one after another (online-only — never the 06.2 outbox, D6), and re-read the
 * active workout once: after the last PATCH, or after the first failure (later PATCHes are not sent).
 * The cards render from the cache, so they redraw once, from that refetch.
 */
export function useRegroup(): { run: (slots: readonly SessionSlot[], op: SessionOp) => Promise<RegroupOutcome>; busy: boolean } {
  const queryClient = useQueryClient();
  const { mutateAsync } = useUpdateWorkoutExercise();
  const inFlight = useRef(false); // synchronous: React state would not have updated before a second tap lands
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (slots: readonly SessionSlot[], op: SessionOp): Promise<RegroupOutcome> => {
      if (inFlight.current) return { status: "busy" };
      const plan = planSessionChange(slots, op);
      if (!plan.ok) return { status: "refused", message: plan.reason === "cap" ? plan.message : NO_FREE_GROUP_MESSAGE };
      if (plan.patches.length === 0) return { status: "done" };
      inFlight.current = true;
      setBusy(true);
      try {
        try {
          for (const patch of plan.patches) await mutateAsync({ id: patch.id, body: bodyOf(patch) });
        } catch (error) {
          await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
          const single = plan.patches.length === 1 && "position" in plan.patches[0]!;
          return { status: "failed", error, single };
        }
        await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
        if (op.type === "move") track("exercise_moved", { direction: op.direction });
        return { status: "done" };
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [mutateAsync, queryClient],
  );

  return { run, busy };
}
