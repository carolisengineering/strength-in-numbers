import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation } from "react-router";

import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { ActiveSession } from "./ActiveSession";
import { classifyWorkoutError } from "./errors";
import { WORKOUT_KEYS, useActiveWorkout } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { RoutinesSection } from "../routines/RoutinesSection";
import { StartWorkout } from "./StartWorkout";

export const GONE_NOTICE = "That workout was already finished or removed.";
export const REFRESH_FAILED_NOTICE = "Couldn't refresh your workout — showing the last copy we have.";
export const STALE_NOTICE = "Your workout was out of date, so it has been reloaded.";
export const RESUMED_NOTICE = "You already had a workout in progress — resumed it.";

export const ROUTINE_GONE_NOTICE = "That routine no longer exists";
export const ROUTINE_NOT_APPLIED_NOTICE = "You already had a workout in progress — resumed it. The routine wasn't applied.";

/** Spec 10.0 AC23 / D16: the preview hands a one-time notice to this screen through router state. */
export interface WorkoutsLocationState {
  readonly notice: "routine-gone" | "routine-not-applied";
}

const LOCATION_NOTICES: Record<WorkoutsLocationState["notice"], string> = {
  "routine-gone": ROUTINE_GONE_NOTICE,
  "routine-not-applied": ROUTINE_NOT_APPLIED_NOTICE,
};

function noticeFromLocation(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const notice = (state as Record<string, unknown>)["notice"];
  return typeof notice === "string" && Object.hasOwn(LOCATION_NOTICES, notice)
    ? LOCATION_NOTICES[notice as WorkoutsLocationState["notice"]]
    : null;
}

/**
 * `/app/workouts` (Spec 06.1 §5.1): asks the server for the in-progress workout on every mount and
 * focus, and shows the Start screen when there is none (a 404 is data, not an error — D1). It owns the
 * one-line notice that survives a change of screen (the "gone" and "resumed" messages).
 */
export function WorkoutsScreen() {
  const active = useActiveWorkout();
  const queryClient = useQueryClient();
  const location = useLocation();
  const [notice, setNotice] = useState<string | null>(() => noticeFromLocation(location.state));
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

  // Clears the state the notice is derived from, so a banner clearing later cannot bring it back.
  const dismissNotice = useCallback(() => {
    setNotice(null);
    setGoneId(null);
  }, []);

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
        onDismissNotice={dismissNotice}
        onStarted={(resumed) => {
          setGoneId(null);
          setNotice(resumed ? RESUMED_NOTICE : null);
        }}
      >
        <RoutinesSection />
      </StartWorkout>
    );
  }

  const workoutId = active.data.id;
  return (
    <ActiveSession
      workout={active.data}
      notice={active.isError ? REFRESH_FAILED_NOTICE : shownNotice}
      // The refresh-failed line reflects live state and clears itself when a refetch succeeds.
      {...(active.isError ? {} : { onDismissNotice: dismissNotice })}
      onGone={(options) => markGone(workoutId, options?.refetched)}
    />
  );
}
