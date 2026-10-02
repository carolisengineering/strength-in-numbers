import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { ActiveSession } from "./ActiveSession";
import { classifyWorkoutError } from "./errors";
import { WORKOUT_KEYS, useActiveWorkout } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { StartWorkout } from "./StartWorkout";

export const GONE_NOTICE = "That workout was already finished or removed.";
export const RESUMED_NOTICE = "You already had a workout in progress — resumed it.";

/**
 * `/app/workouts` (Spec 06.1 §5.1): asks the server for the in-progress workout on every mount and
 * focus, and shows the Start screen when there is none (a 404 is data, not an error — D1). It owns the
 * one-line notice that survives a change of screen (the "gone" and "resumed" messages).
 */
export function WorkoutsScreen() {
  const active = useActiveWorkout();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);

  // The shared "gone" path (§5.8): refetch /active; the screen re-renders as Start (or as whichever
  // workout is active now) with the notice.
  const markGone = useCallback(() => {
    setNotice(GONE_NOTICE);
    void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
  }, [queryClient]);

  useEffect(() => {
    if (active.error) reportUnexpected("load-active", active.error);
  }, [active.error]);

  if (active.isPending) return <Spinner label="Loading your workout…" />;

  if (active.isError) {
    const { requestId } = classifyWorkoutError(active.error, { op: "load-active" });
    return (
      <Screen title="Workouts">
        <InlineNotice tone="error" requestId={requestId} actionLabel="Try again" onAction={() => void active.refetch()}>
          Couldn't load your workout.
        </InlineNotice>
      </Screen>
    );
  }

  if (active.data === null) {
    return <StartWorkout notice={notice} onStarted={(resumed) => setNotice(resumed ? RESUMED_NOTICE : null)} />;
  }

  return <ActiveSession workout={active.data} notice={notice} onGone={markGone} />;
}
