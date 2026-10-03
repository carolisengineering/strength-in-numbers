import { useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { track } from "../../observability/track";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { classifyWorkoutError } from "./errors";
import { WORKOUT_KEYS } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { startWorkoutFields } from "./timestamps";
import { useStartWorkout } from "./useWorkoutMutations";
import styles from "./WorkoutsScreen.module.css";

const CLOCK_MESSAGE = "Your device clock looks wrong — check the date and time, then try again.";
const FAILED_MESSAGE = "Couldn't start your workout — try again.";

export interface StartWorkoutProps {
  /** A one-line message carried over from another screen ("That workout was already finished…"). */
  notice: string | null;
  onDismissNotice?: () => void;
  /** `resumed` is true when the server said a workout was already in progress and we adopted it. */
  onStarted: (resumed: boolean) => void;
}

/**
 * The Start screen (Spec 06.1 §5.2, AC16). The idempotency key is minted on the first tap, held in a
 * ref, reused by every retry and discarded on success (§6.5) — so a retry after a lost response cannot
 * create a second workout. Nothing is persisted: a reload mints a new key, and the
 * `409 workout-in-progress-exists` → resume path covers a started-but-unseen workout.
 */
export function StartWorkout({ notice, onDismissNotice, onStarted }: StartWorkoutProps) {
  const start = useStartWorkout();
  const queryClient = useQueryClient();
  const keyRef = useRef<string | null>(null);
  const inFlight = useRef(false); // synchronous guard: state would not update before a second tap
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);

  async function begin() {
    if (inFlight.current) return;
    inFlight.current = true;
    setError(null);
    keyRef.current ??= crypto.randomUUID();
    try {
      await start.mutateAsync({ body: { clientGeneratedId: keyRef.current, ...startWorkoutFields(new Date()) } });
      keyRef.current = null;
      track("workout_started", { resumed: false });
      onStarted(false);
    } catch (caught) {
      reportUnexpected("start-workout", caught);
      const failure = classifyWorkoutError(caught, { op: "start-workout" });
      if (failure.kind === "workout-in-progress-exists") {
        keyRef.current = null;
        track("workout_started", { resumed: true });
        await queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });
        onStarted(true);
      } else {
        setError(failure.kind === "validation" ? CLOCK_MESSAGE : FAILED_MESSAGE);
        setRequestId(failure.requestId);
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <Screen title="Start a workout">
      <div className={styles.start}>
        <div className={styles.messages}>
          {notice ? <InlineNotice {...(onDismissNotice ? { onDismiss: onDismissNotice } : {})}>{notice}</InlineNotice> : null}
          {error ? (
            <InlineNotice tone="error" requestId={requestId} actionLabel="Try again" onAction={() => void begin()}>
              {error}
            </InlineNotice>
          ) : null}
        </div>
        <Button block busy={start.isPending} onClick={() => void begin()}>
          Start workout
        </Button>
      </div>
    </Screen>
  );
}
