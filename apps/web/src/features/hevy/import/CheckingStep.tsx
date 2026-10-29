import { useEffect, useState, type Ref } from "react";

import { Button } from "../../../ui/Button";
import type { ImportState } from "./importSession";
import { BACK, CHECK_FAILED, CHECK_OFFLINE, CHECKING_TITLE, checkingLine, REPLY_NOT_UNDERSTOOD, TRY_AGAIN } from "./messages";
import styles from "./ImportScreen.module.css";

/** Spec 20.1 AC11: the server dry run's progress, and its failures (a reply not understood offers only Back). */
export function CheckingStep({
  state,
  onBack,
  onRetry,
  headingRef,
}: {
  state: ImportState;
  onBack: () => void;
  onRetry: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  // AC29: the live region is empty at first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const p = state.checkProgress;
  const failure = state.summaryError;
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {CHECKING_TITLE}
      </h2>
      <p className={styles.status} role="status">
        {mounted && failure === null && p !== null ? checkingLine(p.done, p.total) : ""}
      </p>
      {failure === null ? (
        <progress className={styles.progress} aria-hidden="true" max={p && p.total > 0 ? p.total : undefined} value={p && p.total > 0 ? p.done : undefined} />
      ) : (
        <p className={styles.failure} role="alert">
          {failure === "reply" ? REPLY_NOT_UNDERSTOOD : failure === "network" ? CHECK_OFFLINE : CHECK_FAILED}
        </p>
      )}
      {failure !== null ? (
        <div className={styles.actions}>
          <Button variant="secondary" onClick={onBack}>
            {BACK}
          </Button>
          {failure === "reply" ? null : <Button onClick={onRetry}>{TRY_AGAIN}</Button>}
        </div>
      ) : null}
    </section>
  );
}
