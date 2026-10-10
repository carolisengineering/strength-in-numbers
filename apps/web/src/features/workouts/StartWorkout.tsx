import type { ReactNode } from "react";

import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { START_CLOCK_MESSAGE, START_FAILED_MESSAGE, useBeginWorkout } from "./useBeginWorkout";
import styles from "./WorkoutsScreen.module.css";

export interface StartWorkoutProps {
  /** A one-line message carried over from another screen ("That workout was already finished…"). */
  notice: string | null;
  onDismissNotice?: () => void;
  /** `resumed` is true when the server said a workout was already in progress and we adopted it. */
  onStarted: (resumed: boolean) => void;
  /** Rendered under the Start button — Spec 10.0's Routines section. */
  children?: ReactNode;
}

/**
 * The Start screen (Spec 06.1 §5.2, AC16; Spec 10.0 AC14). The idempotent start lives in
 * `useBeginWorkout`; nothing is persisted — a reload mints a new key, and the
 * `409 workout-in-progress-exists` → resume path covers a started-but-unseen workout.
 */
export function StartWorkout({ notice, onDismissNotice, onStarted, children }: StartWorkoutProps) {
  const { begin, busy, failure } = useBeginWorkout();

  async function onStart() {
    const outcome = await begin();
    if (outcome?.kind === "started") onStarted(false);
    else if (outcome?.kind === "resumed") onStarted(true);
  }

  const error = failure === null ? null : failure.kind === "validation" ? START_CLOCK_MESSAGE : START_FAILED_MESSAGE;

  return (
    <Screen title="Start a workout">
      <div className={styles.start}>
        <div className={styles.messages}>
          {notice ? <InlineNotice {...(onDismissNotice ? { onDismiss: onDismissNotice } : {})}>{notice}</InlineNotice> : null}
          {error ? (
            <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void onStart()}>
              {error}
            </InlineNotice>
          ) : null}
        </div>
        <Button block busy={busy} onClick={() => void onStart()}>
          Start empty workout
        </Button>
        {children}
      </div>
    </Screen>
  );
}
