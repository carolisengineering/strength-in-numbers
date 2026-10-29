import { useEffect, useRef } from "react";

import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { Screen } from "../../../ui/Screen";
import { Spinner } from "../../../ui/Spinner";
import { HEVY_PATH } from "../paths";
import { ImportSteps } from "./ImportSteps";
import { BACK_TO_HEVY, IMPORT_TITLE, PREPARING, PREPARING_FAILED, reconcileLine, TRY_AGAIN } from "./messages";
import { PreflightStep } from "./PreflightStep";
import { reconcile } from "./readHevy";
import { ReadingStep } from "./ReadingStep";
import { useImportSession } from "./useImportSession";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 §5, D1: one screen with steps. Each step change moves focus to the new step's heading (AC29); the
 * session (everything read from Hevy) lives in `useImportSession` and goes when this unmounts (AC15).
 */
export function ImportScreen() {
  const session = useImportSession();
  const { state } = session;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const shownStep = useRef(state.step);

  useEffect(() => {
    if (shownStep.current === state.step) return;
    shownStep.current = state.step;
    headingRef.current?.focus();
  }, [state.step]);

  const reconciled = state.read === null ? null : reconcile(state.read);

  return (
    <Screen title={IMPORT_TITLE} lead={<BackLink to={HEVY_PATH} label={BACK_TO_HEVY} />}>
      <div className={styles.body}>
        <ImportSteps step={state.step} />
        {reconciled?.differs ? <p className={styles.text}>{reconcileLine(reconciled.reported, reconciled.read)}</p> : null}
        {state.step === "preflight" ? <PreflightStep onStart={session.start} headingRef={headingRef} /> : null}
        {state.step === "reading" ? (
          <ReadingStep state={state} onCancel={session.cancel} onRetry={session.retryRead} headingRef={headingRef} />
        ) : null}
        {state.step === "preparing" ? (
          <section className={styles.step} aria-labelledby="hevy-import-step">
            <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
              {PREPARING}
            </h2>
            {session.preparingFailed ? (
              <>
                <p className={styles.failure} role="alert">
                  {PREPARING_FAILED}
                </p>
                <div className={styles.actions}>
                  <Button onClick={() => void session.mapping.refetch()}>{TRY_AGAIN}</Button>
                </div>
              </>
            ) : (
              <Spinner label={PREPARING} />
            )}
          </section>
        ) : null}
      </div>
    </Screen>
  );
}
