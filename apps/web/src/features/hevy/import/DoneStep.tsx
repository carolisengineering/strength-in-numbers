import { useEffect, useMemo, useState, type Ref } from "react";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import { HEVY_PATH } from "../paths";
import { buildImportReport, downloadReport } from "./importReport";
import type { ImportState } from "./importSession";
import { aggregateResults, finalResults } from "./importSummary";
import {
  alreadyInSinLine,
  BACK_TO_HEVY,
  DONE_TITLE,
  doneWorkoutsLine,
  DOWNLOAD_REPORT,
  exercisesCreatedLine,
  FINISH_FAILED,
  WRAP_UP_FAILED,
  FINISHING,
  notSentLine,
  RECORDS_UPDATED,
  ROUTINE_NOTES,
  ROUTINE_NOTICE_LABELS,
  ROUTINE_PROBLEM_LABELS,
  routineLimitLine,
  ROUTINES_NOT_CREATED,
  routinesDoneLine,
  setsDroppedLine,
  TRY_AGAIN,
  VIEW_HISTORY,
} from "./messages";
import styles from "./ImportScreen.module.css";

const HISTORY_PATH = "/app/history";

/**
 * Spec 20.1 AC22, AC25, AC26, §5.7: the done screen. Every count comes from the run's own results where a workout was
 * sent (§6.6), the dry run's elsewhere; a workout never sent because of a Stop is counted on its own (O2 / D18).
 */
export function DoneStep({
  state,
  zone,
  onRetryFinish,
  headingRef,
}: {
  state: ImportState;
  zone: string;
  onRetryFinish: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  // AC29: the live region is empty at first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const final = useMemo(() => finalResults(state.results ?? [], state.run?.results ?? []), [state.results, state.run]);
  const agg = useMemo(() => aggregateResults(final.results, state.unreadable), [final, state.unreadable]);
  const routines = state.routineResults;
  const count = (kind: (typeof routines)[number]["kind"]) => routines.filter((r) => r.kind === kind).length;
  const notCreated = routines.filter((r) => r.kind === "limit_not_created");
  const noted = routines.filter((r) => r.kind in ROUTINE_PROBLEM_LABELS || r.notices.length > 0);
  const skipped = count("no_items");
  const routineLine = routinesDoneLine(count("created"), count("exists"), skipped, routines.length - count("created") - count("exists") - skipped);
  const finish = state.finish;

  const download = () => {
    if (state.read === null) return;
    downloadReport(buildImportReport({ ...final, workouts: state.read.workouts, unreadable: state.unreadable, routines, zone }));
  };

  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {DONE_TITLE}
      </h2>
      <p className={styles.text}>{doneWorkoutsLine(agg.create, agg.duplicate, agg.cannotImport)}</p>
      {agg.alreadyInSin > 0 ? <p className={styles.text}>{alreadyInSinLine(agg.alreadyInSin)}</p> : null}
      {final.notSent.length > 0 ? <p className={styles.text}>{notSentLine(final.notSent.length)}</p> : null}
      <p className={styles.text}>{setsDroppedLine(agg.setsDropped)}</p>
      {routineLine !== "" ? <p className={styles.text}>{routineLine}</p> : null}
      {state.exercisesCreated > 0 ? <p className={styles.text}>{exercisesCreatedLine(state.exercisesCreated)}</p> : null}
      {notCreated.length > 0 ? (
        <div className={styles.card}>
          <p className={styles.failure}>{routineLimitLine(notCreated.length)}</p>
          <ul className={styles.list} aria-label={ROUTINES_NOT_CREATED}>
            {notCreated.map((r) => (
              <li key={r.hevyRoutineId}>{r.name}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {noted.length > 0 ? (
        <ul className={styles.list} aria-label={ROUTINE_NOTES}>
          {noted.map((r) => (
            <li key={r.hevyRoutineId}>
              {r.name}:{" "}
              {[
                ...(r.kind in ROUTINE_PROBLEM_LABELS ? [ROUTINE_PROBLEM_LABELS[r.kind as keyof typeof ROUTINE_PROBLEM_LABELS]] : []),
                ...r.notices.map((n) => ROUTINE_NOTICE_LABELS[n.code]),
              ].join("; ")}
            </li>
          ))}
        </ul>
      ) : null}
      <p className={styles.status} role="status">
        {!mounted ? "" : finish === "ok" ? RECORDS_UPDATED : finish === "running" ? FINISHING : ""}
      </p>
      {state.wrapUpFailed ? (
        <p className={styles.failure} role="alert">
          {WRAP_UP_FAILED}
        </p>
      ) : null}
      {finish === "failed" ? (
        <div className={styles.card} role="alert">
          <p className={styles.failure}>{FINISH_FAILED}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onRetryFinish}>
              {TRY_AGAIN}
            </Button>
          </div>
        </div>
      ) : null}
      <div className={styles.actions}>
        <Link className={styles.link} to={HISTORY_PATH}>
          {VIEW_HISTORY}
        </Link>
        <Button variant="secondary" onClick={download}>
          {DOWNLOAD_REPORT}
        </Button>
        <Link className={styles.link} to={HEVY_PATH}>
          {BACK_TO_HEVY}
        </Link>
      </div>
    </section>
  );
}
