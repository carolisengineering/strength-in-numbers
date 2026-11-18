import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router";

import { InlineNotice } from "../../ui/InlineNotice";
import { usePane } from "../../ui/paneContext";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { ActiveSession } from "./ActiveSession";
import { classifyWorkoutError } from "./errors";
import { WORKOUT_KEYS, useActiveWorkout } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { RoutinesSection } from "../routines/RoutinesSection";
import { StartWorkout } from "./StartWorkout";
import { GoneWorkoutCard } from "./GoneWorkoutCard";
import { LandedLine } from "./LandedLine";
import { WaitingFinishCard } from "./WaitingFinishCard";
import { useWaitingFinish } from "./useWaitingFinish";
import { useFinishTap } from "./finishTap";

export const GONE_NOTICE = "That workout was already finished or removed.";
export const REFRESH_FAILED_NOTICE = "Couldn't refresh your workout — showing the last copy we have.";
export const STALE_NOTICE = "Your workout was out of date, so it has been reloaded.";
export const RESUMED_NOTICE = "You already had a workout in progress — resumed it.";

export const ROUTINE_GONE_NOTICE = "That routine no longer exists";
export const ROUTINE_NOT_APPLIED_NOTICE = "You already had a workout in progress — resumed it. The routine wasn't applied.";

/**
 * Spec 10.0 AC23 / D16: the preview hands a one-time notice to this screen through router state. Spec 17.12 AC26: a
 * start from the list pane carries `resumed` (its own screen has unmounted by then), and `startEmpty` asks the list
 * pane's Start to begin once it has left an open routine (the editor's leave guard may stop that navigation first).
 */
export interface WorkoutsLocationState {
  readonly notice?: "routine-gone" | "routine-not-applied" | "resumed";
  readonly startEmpty?: true;
}

type LocationNotice = NonNullable<WorkoutsLocationState["notice"]>;

const LOCATION_NOTICES: Record<LocationNotice, string> = {
  "routine-gone": ROUTINE_GONE_NOTICE,
  "routine-not-applied": ROUTINE_NOT_APPLIED_NOTICE,
  resumed: RESUMED_NOTICE,
};

function noticeFromLocation(state: unknown): string | null {
  if (typeof state !== "object" || state === null) return null;
  const notice = (state as Record<string, unknown>)["notice"];
  return typeof notice === "string" && Object.hasOwn(LOCATION_NOTICES, notice)
    ? LOCATION_NOTICES[notice as LocationNotice]
    : null;
}

/**
 * `/app/workouts` (Spec 06.1 §5.1): asks the server for the in-progress workout on every mount and
 * focus, and shows the Start screen when there is none (a 404 is data, not an error — D1). It owns the
 * one-line notice that survives a change of screen (the "gone" and "resumed" messages).
 */
export function WorkoutsScreen() {
  const active = useActiveWorkout();
  // Spec 06.7 AC26, AC30: a finish op in the outbox decides first, from storage, before (and without) the active read.
  const finishing = useWaitingFinish();
  // A Finish tap in progress on this screen keeps ActiveSession: the tap opens the summary itself.
  const tapping = useFinishTap();
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const inList = usePane().slot === "list";
  const [notice, setNotice] = useState<string | null>(() => noticeFromLocation(location.state));
  // Spec 17.12 AC26: beside a routine this screen stays mounted across navigation, so a notice handed over later (the
  // preview's "gone", a resumed start) arrives on a new location rather than at mount. Only a location that holds one
  // sets it; any other navigation leaves the line as it is.
  const locationNotice = noticeFromLocation(location.state);
  useEffect(() => {
    if (locationNotice === null) return;
    setNotice(locationNotice);
    setGoneId(null);
    // The list pane's "resumed" hand-off is read once and taken out of the entry, so a reload or a Back into it never
    // says it again (final review M3). The phone's own notices keep today's behavior.
    if (locationNotice === RESUMED_NOTICE) void navigate(location.pathname, { replace: true, state: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per location: the key is the event, not the text
  }, [location.key]);
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

  if (finishing.waiting && finishing.op && finishing.op.workoutId !== tapping) {
    return (
      <Screen title="Workouts" hideTitle>
        <WaitingFinishCard op={finishing.op} />
      </Screen>
    );
  }
  // A refused finish whose workout the server no longer has live is gone (AC30); still live, it reopens (AC29).
  const refused = finishing.failed ? finishing.op : null;
  // A 404 counts only when it was the finish's own answer: a finish blocked by a write that got a 404 inherits the
  // status (`blockedBy`), and that workout is still live (code review).
  const ownNotFound = refused?.failure?.status === 404 && refused.failure.blockedBy === undefined;
  const gone =
    refused !== null && (ownNotFound || (!active.isPending && active.data !== undefined && active.data?.id !== refused.workoutId));
  if (refused !== null && gone) {
    return (
      <Screen title="Workouts" hideTitle>
        <GoneWorkoutCard workoutId={refused.workoutId} />
      </Screen>
    );
  }

  if (active.isPending) return <Spinner label="Loading your workout…" />;

  // Only a failure with nothing to show is a screen of its own. A background refetch that fails (a
  // phone back from another app on a flaky connection) leaves the last good copy in `data`; replacing
  // the session with an error would unmount it and discard every unlogged draft.
  if (active.isError && active.data === undefined) {
    const { requestId } = classifyWorkoutError(active.error, { op: "load-active" });
    return (
      <Screen title="Workouts" hideTitle>
        <InlineNotice tone="error" requestId={requestId} actionLabel="Try again" onAction={() => void active.refetch()}>
          Couldn't load your workout.
        </InlineNotice>
      </Screen>
    );
  }

  if (active.data === null) {
    return (
      <StartWorkout
        lead={<LandedLine />}
        notice={shownNotice}
        onDismissNotice={dismissNotice}
        onStarted={(resumed) => {
          // Spec 17.12 AC26: a started workout turns the panes off, and the session's screen is a new instance, so
          // the list pane hands the notice over through the location rather than its own state.
          if (inList) {
            void navigate("/app/workouts", { replace: true, state: resumed ? { notice: "resumed" } : null });
            return;
          }
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
