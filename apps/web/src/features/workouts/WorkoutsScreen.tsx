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
export const REFRESH_FAILED_NOTICE = "Couldn't refresh your workout — showing the last copy we have.";
export const STALE_NOTICE = "Your workout was out of date, so it has been reloaded.";
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
  // The workout a write reported gone (§5.8). What to say about it is derived from what the refetch
  // finds, not decided up front: the API answers 404 for a set or exercise that vanished while the
  // workout itself is fine, and "already finished or removed" would then be false.
  const [goneId, setGoneId] = useState<string | null>(null);

  const markGone = useCallback(
    (workoutId: string, refetched = false) => {
      setGoneId(workoutId);
      if (!refetched) void queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
    },
    [queryClient],
  );

  const goneNotice =
    goneId === null ? null : active.data?.id === goneId ? STALE_NOTICE : GONE_NOTICE;
  const shownNotice = goneNotice ?? notice;

  useEffect(() => {
    if (active.error) reportUnexpected("load-active", active.error);
  }, [active.error]);

  if (active.isPending) return <Spinner label="Loading your workout…" />;

  // Only a failure with nothing to show is a screen of its own. A background refetch that fails (a
  // phone back from another app on a flaky connection) leaves the last good copy in `data`; replacing
  // the session with an error would unmount it and discard every unlogged draft.
  if (active.isError && active.data === undefined) {
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
    return (
      <StartWorkout
        notice={shownNotice}
        onStarted={(resumed) => {
          setGoneId(null);
          setNotice(resumed ? RESUMED_NOTICE : null);
        }}
      />
    );
  }

  const workoutId = active.data.id;
  return (
    <ActiveSession
      workout={active.data}
      notice={active.isError ? REFRESH_FAILED_NOTICE : shownNotice}
      onGone={(options) => markGone(workoutId, options?.refetched)}
    />
  );
}
