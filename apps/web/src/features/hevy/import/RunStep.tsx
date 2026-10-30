import { useEffect, useMemo, useState, type Ref } from "react";

import { Button } from "../../../ui/Button";
import type { ImportState } from "./importSession";
import { aggregateResults, finalResults } from "./importSummary";
import {
  BACK_ONLINE,
  creatingRoutinesLine,
  FINISH_UP,
  FINISHING,
  KEEP_TAB_OPEN,
  PAUSED,
  RESUME,
  ROUTINES_RUN_TITLE,
  RUN_TITLE,
  runningLine,
  STOP,
  STOP_AUTH,
  STOP_GATE,
  STOP_INVALID,
  stopInvalidPath,
  STOPPED_TITLE,
  stoppedLine,
  STOPPING,
} from "./messages";
import styles from "./ImportScreen.module.css";

/** "Oct 2024": the month of the batch in flight, in the device zone. */
export function batchMonth(iso: string, zone: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: zone }).format(new Date(iso));
}

/** AC29: a live region that is empty at first paint. */
function useMounted() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

/**
 * Spec 20.1 AC16, AC19, AC20, §5.6: the run — running, paused and stopped. The progress line changes once per batch
 * (it is built from the batch results, never per workout). A stop's reason is static text plus, for a `422`, the
 * batch's first error path; never a title.
 */
export function RunStep({
  state,
  zone,
  stopping,
  backOnline,
  onStop,
  onResume,
  onFinishUp,
  headingRef,
}: {
  state: ImportState;
  zone: string;
  stopping: boolean;
  backOnline: boolean;
  onStop: () => void;
  onResume: () => void;
  onFinishUp: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const mounted = useMounted();
  const run = state.run;
  const skipped = useMemo(() => {
    if (run === null || state.results === null) return 0;
    return aggregateResults(finalResults(state.results, run.results).results, state.unreadable).cannotImport;
  }, [run, state.results, state.unreadable]);
  if (run === null) return null;
  const stopped = state.step === "stopped";
  const reason = run.stopReason;

  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {stopped ? STOPPED_TITLE : RUN_TITLE}
      </h2>
      <p className={styles.status} role="status">
        {mounted && !stopped ? (
          <>
            <span>{runningLine(run.sent, run.total, skipped)}</span>
            {state.step === "running" && run.batchDate !== null ? <span className={styles.muted}>{batchMonth(run.batchDate, zone)}</span> : null}
          </>
        ) : null}
      </p>
      {!stopped ? <progress className={styles.progress} aria-hidden="true" max={Math.max(run.total, 1)} value={run.sent} /> : null}
      {state.step === "running" ? (
        <>
          <p className={styles.text}>{stopping ? STOPPING : KEEP_TAB_OPEN}</p>
          <div className={styles.actions}>
            <Button variant="secondary" disabled={stopping} onClick={onStop}>
              {STOP}
            </Button>
          </div>
        </>
      ) : null}
      {state.step === "paused" ? (
        <div className={styles.card}>
          <p className={styles.failure} role="alert">
            {PAUSED}
          </p>
          <p className={styles.status} role="status">
            {mounted && backOnline ? BACK_ONLINE : ""}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onStop}>
              {STOP}
            </Button>
            <Button onClick={onResume}>{RESUME}</Button>
          </div>
        </div>
      ) : null}
      {stopped ? (
        <>
          <p className={styles.text}>{stoppedLine(run.sent, run.total)}</p>
          {reason?.kind === "invalid" ? (
            <div className={styles.card} role="alert">
              <p className={styles.failure}>{STOP_INVALID}</p>
              {reason.path !== "" ? <p className={styles.muted}>{stopInvalidPath(reason.path)}</p> : null}
            </div>
          ) : null}
          {reason?.kind === "gate" ? (
            <p className={styles.failure} role="alert">
              {STOP_GATE}
            </p>
          ) : null}
          {reason?.kind === "auth" ? (
            <p className={styles.failure} role="alert">
              {STOP_AUTH}
            </p>
          ) : null}
          {reason?.kind === "user" || reason?.kind === "invalid" ? (
            <div className={styles.actions}>
              {reason.kind === "user" ? (
                <Button variant="secondary" onClick={onResume}>
                  {RESUME}
                </Button>
              ) : null}
              <Button onClick={onFinishUp}>{FINISH_UP}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/** AC22, AC23: the finish step, then the routines, each with its polite status. */
export function WrapUpStep({ state, headingRef }: { state: ImportState; headingRef: Ref<HTMLHeadingElement> }) {
  const mounted = useMounted();
  const routines = state.step === "routines_run";
  const p = state.routineProgress;
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {routines ? ROUTINES_RUN_TITLE : RUN_TITLE}
      </h2>
      <p className={styles.status} role="status">
        {!mounted ? "" : routines ? (p === null ? "" : creatingRoutinesLine(p.done, p.total)) : FINISHING}
      </p>
      <progress className={styles.progress} aria-hidden="true" max={routines && p !== null && p.total > 0 ? p.total : undefined} value={routines && p !== null && p.total > 0 ? p.done : undefined} />
      <p className={styles.text}>{KEEP_TAB_OPEN}</p>
    </section>
  );
}
