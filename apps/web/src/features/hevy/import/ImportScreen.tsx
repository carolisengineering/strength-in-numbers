import { useEffect, useRef } from "react";

import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { Screen } from "../../../ui/Screen";
import { Spinner } from "../../../ui/Spinner";
import { useLeaveGuard } from "../../../ui/useLeaveGuard";
import { HEVY_PATH } from "../paths";
import { CheckingStep } from "./CheckingStep";
import { DoneStep } from "./DoneStep";
import { backFromSummary, isSummaryStale, type ImportState } from "./importSession";
import { ImportSteps } from "./ImportSteps";
import { ImportSummaryView } from "./ImportSummaryView";
import { BACK_TO_HEVY, IMPORT_TITLE, LEAVE_BODY, LEAVE_CONFIRM, LEAVE_TITLE, PREPARING, PREPARING_FAILED, reconcileLine, TRY_AGAIN } from "./messages";
import { MarkersStep } from "./MarkersStep";
import { NamesStep } from "./NamesStep";
import { deviceZone, PreflightStep } from "./PreflightStep";
import { reconcile } from "./readHevy";
import { ReadingStep } from "./ReadingStep";
import { RoutinePicksStep } from "./RoutinePicksStep";
import { RunStep, WrapUpStep } from "./RunStep";
import { useImportSession } from "./useImportSession";
import styles from "./ImportScreen.module.css";

/** The steps from the run on (Spec 20.1 AC16–AC25). */
const RUN_STEPS: ReadonlySet<ImportState["step"]> = new Set(["running", "paused", "stopped", "finishing", "routines_run", "done"]);

/**
 * Spec 20.1 §5, D1: one screen with steps. Each step change moves focus to the new step's heading (AC29); the
 * session (everything read from Hevy) lives in `useImportSession` and goes when this unmounts (AC15).
 */

export function ImportScreen({ onRunStarted }: { onRunStarted?: () => void } = {}) {
  const session = useImportSession();
  const { state } = session;
  const runStarted = RUN_STEPS.has(state.step);
  useEffect(() => {
    if (runStarted) onRunStarted?.();
  }, [runStarted, onRunStarted]);
  const headingRef = useRef<HTMLHeadingElement>(null);
  // Saving the names is the names step busy, not a new step: focus stays on Continue.
  const view = state.step === "saving_names" ? "names" : state.step;
  const shownView = useRef(view);

  useEffect(() => {
    if (shownView.current === view) return;
    shownView.current = view;
    headingRef.current?.focus();
  }, [view]);

  const reconciled = state.read === null ? null : reconcile(state.read);
  // AC20: leaving while the import writes asks first (Spec 20.1 D20: the finish and routines steps write too).
  const writing = state.step === "running" || state.step === "finishing" || state.step === "routines_run";
  const leave = useLeaveGuard(writing, session.stop);

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
                  <Button onClick={session.retryPreparing}>{TRY_AGAIN}</Button>
                </div>
              </>
            ) : (
              <Spinner label={PREPARING} />
            )}
          </section>
        ) : null}
        {state.step === "routines" ? (
          <RoutinePicksStep
            state={state}
            pickContext={session.pickContext}
            routinesStatus={session.routinesList.status}
            onRetryRoutines={() => void session.routinesList.refetch()}
            onToggle={session.toggleRoutine}
            onTickAll={session.tickAll}
            onContinue={session.continueFlow}
            headingRef={headingRef}
          />
        ) : null}
        {state.step === "markers" ? <MarkersStep onDone={session.continueFlow} onSkip={session.skipMarkers} headingRef={headingRef} /> : null}
        {state.step === "names" || state.step === "saving_names" ? (
          <NamesStep
            state={state}
            dispatch={session.dispatch}
            onSave={() => void session.saveNames()}
            onBack={state.read !== null && state.read.routines.length > 0 ? () => session.back("routines") : null}
            headingRef={headingRef}
          />
        ) : null}
        {state.step === "checking" ? (
          <CheckingStep state={state} onBack={() => session.back(backFromSummary(state))} onRetry={session.recheck} headingRef={headingRef} />
        ) : null}
        {state.step === "summary" ? (
          <ImportSummaryView
            state={state}
            zone={deviceZone()}
            stale={isSummaryStale(state, session.mapping.data)}
            onBack={() => session.back(backFromSummary(state))}
            onBackToNames={() => void session.backToNames()}
            onCheckAgain={session.recheck}
            onImport={session.run}
            canImport={session.canImport}
            blocked={session.importBlocked}
            headingRef={headingRef}
          />
        ) : null}
        {state.step === "running" || state.step === "paused" || state.step === "stopped" ? (
          <RunStep
            state={state}
            zone={deviceZone()}
            stopping={session.stopping}
            backOnline={session.backOnline}
            onStop={session.stop}
            onResume={session.resume}
            onFinishUp={session.finishUp}
            headingRef={headingRef}
          />
        ) : null}
        {state.step === "finishing" || state.step === "routines_run" ? <WrapUpStep state={state} headingRef={headingRef} /> : null}
        {state.step === "done" ? <DoneStep state={state} zone={deviceZone()} onRetryFinish={session.retryFinish} headingRef={headingRef} /> : null}
      </div>
      <ConfirmDialog open={leave.open} title={LEAVE_TITLE} confirmLabel={LEAVE_CONFIRM} onConfirm={leave.confirm} onCancel={leave.cancel}>
        <p>{LEAVE_BODY}</p>
      </ConfirmDialog>
    </Screen>
  );
}
