import { useState, type ReactNode } from "react";

import { ActionBar } from "../../ui/ActionBar";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
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

  const error = failure === null ? null : failure.kind === "validation" ? START_CLOCK_MESSAGE : START_FAILED_MESSAGE;

  return (
    <Screen title="Start a workout">
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
      <ActionBar>
        <Button busy={busy} onClick={() => void onStart()}>
          Start empty workout
        </Button>
      </ActionBar>
    </Screen>
  );
}
