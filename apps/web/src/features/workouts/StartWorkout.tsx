import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useLocation, useMatch, useNavigate } from "react-router";

import { ActionBar } from "../../ui/ActionBar";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { usePane } from "../../ui/paneContext";
import { Screen } from "../../ui/Screen";
import { START_CLOCK_MESSAGE, START_FAILED_MESSAGE, useBeginWorkout } from "./useBeginWorkout";
import { useWaitingFinish } from "./useWaitingFinish";
import styles from "./WorkoutsScreen.module.css";

export interface StartWorkoutProps {
  /** A one-line message carried over from another screen ("That workout was already finished…"). */
  notice: string | null;
  onDismissNotice?: () => void;
  /** `resumed` is true when the server said a workout was already in progress and we adopted it. */
  onStarted: (resumed: boolean) => void;
  /** Spec 10.0's Routines section, rendered above the bottom bar's Start button. */
  children?: ReactNode;
  /** Spec 06.7 AC27: the one-time "saved" line, above everything else. */
  lead?: ReactNode;
}

/**
 * The Start screen (Spec 06.1 §5.2, AC16; Spec 10.0 AC14). The idempotent start lives in
 * `useBeginWorkout`; nothing is persisted — a reload mints a new key, and the
 * `409 workout-in-progress-exists` → resume path covers a started-but-unseen workout.
 */
export function StartWorkout({ notice, onDismissNotice, onStarted, children, lead }: StartWorkoutProps) {
  const { begin, busy, failure } = useBeginWorkout();
  // Spec 17.12 AC25: in the list pane Start sits under the title (no bottom bar); M2: secondary while a routine's
  // preview or editor is open beside it, whose Start or Save is then the screen's one primary.
  const inList = usePane().slot === "list";
  const routineOpen = useMatch("/app/workouts/routines/:id/*") !== null;
  // Spec 06.7 AC18: a finish op is in the outbox; nothing was sent.
  const [blockedAt, setBlocked] = useState<string | null>(null);
  // Said only while a finish op is still there: once it lands, Start works and the warning would contradict the line.
  const blocked = useWaitingFinish().op === null ? null : blockedAt;

  async function onStart() {
    setBlocked(null);
    const outcome = await begin();
    if (outcome?.kind === "started") onStarted(false);
    else if (outcome?.kind === "resumed") onStarted(true);
    else if (outcome?.kind === "blocked") setBlocked(outcome.message);
  }

  // Spec 17.12 AC26: beside an open routine, Start first leaves it for /app/workouts, so the editor's leave guard can ask
  // before anything is created; this screen (still mounted in the list pane) starts on arrival, once per location.
  const navigate = useNavigate();
  const location = useLocation();
  const startedFor = useRef<string | null>(null);
  // Only this instance's own tap starts (final review M4): an entry left with `startEmpty` (the panes were off when it
  // landed, then came back on Back) is cleared, never acted on.
  const armed = useRef(false);
  const startOnArrival = useEffectEvent(() => void onStart());
  useEffect(() => {
    if (!inList || !isStartEmpty(location.state) || startedFor.current === location.key) return;
    startedFor.current = location.key;
    void navigate(location.pathname, { replace: true, state: null });
    if (!armed.current) return;
    armed.current = false;
    startOnArrival();
  }, [inList, location.key, location.state, location.pathname, navigate]);

  function onStartTap() {
    if (inList && routineOpen) {
      armed.current = true;
      void navigate("/app/workouts", { state: { startEmpty: true } });
    } else void onStart();
  }

  const error = failure === null ? null : failure.kind === "validation" ? START_CLOCK_MESSAGE : START_FAILED_MESSAGE;

  const startButton = (
    <Button busy={busy} onClick={onStartTap} {...(inList ? { block: true, variant: routineOpen ? "secondary" : "primary" } : {})}>
      Start empty workout
    </Button>
  );

  return (
    <Screen title="Start a workout">
      {inList ? startButton : null}
      <div className={styles.start}>
        <div className={styles.messages}>
          {lead}
          {blocked ? <InlineNotice tone="warning">{blocked}</InlineNotice> : null}
          {notice ? <InlineNotice {...(onDismissNotice ? { onDismiss: onDismissNotice } : {})}>{notice}</InlineNotice> : null}
          {error ? (
            <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void onStart()}>
              {error}
            </InlineNotice>
          ) : null}
        </div>
        {children}
      </div>
      {/* Spec 06.1 §5.2: the Start button sits in the thumb zone — the bottom bar, below the routines. */}
      {inList ? null : <ActionBar>{startButton}</ActionBar>}
    </Screen>
  );
}

function isStartEmpty(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as Record<string, unknown>)["startEmpty"] === true;
}
