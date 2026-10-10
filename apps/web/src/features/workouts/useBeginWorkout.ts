// apps/web/src/features/workouts/useBeginWorkout.ts
import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RoutineId } from "@sin/core";
import { track } from "../../observability/track";
import { classifyWorkoutError, type ClassifiedError } from "./errors";
import { WORKOUT_KEYS } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { startWorkoutFields } from "./timestamps";
import { useStartWorkout } from "./useWorkoutMutations";

export const START_CLOCK_MESSAGE = "Your device clock looks wrong — check the date and time, then try again.";
export const START_FAILED_MESSAGE = "Couldn't start your workout — try again.";

export type BeginOutcome = { kind: "started" } | { kind: "resumed" } | { kind: "failed"; failure: ClassifiedError };

/**
 * The idempotent start (Spec 06.1 §6.5, extracted by Spec 10.0 AC13 / D13). The key is minted on the
 * first call, held in a ref, reused by every retry and discarded on success, so a retry after a lost
 * response cannot create a second workout. One key per mounted surface. `409 workout-in-progress-exists`
 * adopts the running workout. The caller decides what each outcome means (navigation, messages).
 */
export function useBeginWorkout(options: { routineId?: string } = {}) {
  const { routineId } = options;
  const start = useStartWorkout();
  const queryClient = useQueryClient();
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false); // synchronous guard: state would not update before a second tap
  const [failure, setFailure] = useState<ClassifiedError | null>(null);
  const { mutateAsync } = start;

  const begin = useCallback(async (): Promise<BeginOutcome | null> => {
    if (inFlight.current) return null;
    inFlight.current = true;
    setFailure(null);
    keyRef.current ??= crypto.randomUUID();
    const fromRoutine = routineId !== undefined;
    try {
      await mutateAsync({
        body: {
          clientGeneratedId: keyRef.current,
          ...startWorkoutFields(new Date()),
          // A route param, not parsed: the server validates it (a malformed id answers 422/404).
          ...(routineId === undefined ? {} : { routineId: routineId as RoutineId }),
        },
      });
      keyRef.current = null;
      track("workout_started", { resumed: false, fromRoutine });
      return { kind: "started" };
    } catch (caught) {
      reportUnexpected("start-workout", caught);
      const classified = classifyWorkoutError(caught, { op: "start-workout" });
      if (classified.kind === "workout-in-progress-exists") {
        keyRef.current = null;
        track("workout_started", { resumed: true, fromRoutine });
        await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
        return { kind: "resumed" };
      }
      setFailure(classified);
      return { kind: "failed", failure: classified };
    } finally {
      inFlight.current = false;
    }
  }, [mutateAsync, queryClient, routineId]);

  return { begin, busy: start.isPending, failure };
}
