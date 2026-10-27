import { lineageRootId } from "@sin/core";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";

import { NotFound } from "../../screens/NotFound";
import { BackLink } from "../../ui/BackLink";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useCatalog } from "../catalog/useCatalog";
import { ExerciseProgressBody } from "../progress/ExerciseProgressBody";
import { groupByExercise } from "../progress/exercises";
import { useSeries } from "../progress/queries";
import { useExerciseRecords } from "../records/queries";
import { classifyWorkoutError } from "../workouts/errors";
import { ExerciseActions } from "./ExerciseActions";
import { ExerciseDetails } from "./ExerciseDetails";
import styles from "./ExerciseScreen.module.css";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, exercisePath, FROM_RECORDS, RECORDS_PATH } from "./paths";
import { useExerciseUsage } from "./usage";
import { useExercisePage } from "./useExercisePage";

/** Keys the page by id, so moving between exercises starts from the default range and metric (AC20). */
export function ExerciseRoute() {
  const { id = "" } = useParams();
  return <ExerciseScreen key={id} exerciseId={id} />;
}

/**
 * One exercise's page (Spec 18.2 §6.3): its details, then today's Progress body, or the never-logged line;
 * a deleted exercise keeps its history. The 08.1 gone rule (a series 404 / 422 with no data) wins over
 * whatever the catalog says.
 */
export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const resolution = useExercisePage(exerciseId);
  const usage = useExerciseUsage();
  const { refresh } = useCatalog();
  const location = useLocation();
  const neverLogged =
    resolution.kind === "found" && usage.data !== undefined && !usage.data.has(lineageRootId(resolution.row));
  const showBody = resolution.kind === "deleted" || (resolution.kind === "found" && !neverLogged);
  const records = useExerciseRecords(exerciseId, { enabled: showBody });
  const series = useSeries(exerciseId, "3m", { enabled: showBody });
  // Phase B: one polite status line (Saved., copy ready, a failure that closed a sheet), empty at first paint.
  const [status, setStatus] = useState("");
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const navigate = useNavigate();

  // AC43: the copy lands here with `{ notice: "copied" }`. Read it from the location (not a state initializer:
  // the page may already be mounted by the built-in's own redirect), then clear it so a reload doesn't repeat it.
  const routerState = location.state as { from?: unknown; notice?: unknown } | null;
  useEffect(() => {
    if (routerState?.notice !== "copied") return;
    setStatus(EXERCISES_COPY.copyReady);
    void navigate(location.pathname, { replace: true, state: routerState.from === "records" ? FROM_RECORDS : null });
    titleRef.current?.focus();
  }, [routerState, location.pathname, navigate]);
  const statusLine = (
    // `role="status"` is polite by itself; no explicit `aria-live`, so it isn't mistaken for the chart's readout.
    <p className={styles.status} role="status" data-testid="exercise-status">
      {status}
    </p>
  );

  const gone = series.data === undefined && series.error ? classifyWorkoutError(series.error).kind : null;
  if (gone === "not-found" || gone === "validation") return <NotFound />;

  if (resolution.kind === "loading") return <Spinner label={EXERCISES_COPY.loadingExercise} />;
  if (resolution.kind === "error") {
    return (
      <InlineNotice tone="error" actionLabel={EXERCISES_COPY.retry} onAction={() => void refresh(true)}>
        {EXERCISES_COPY.loadExercisesFailed}
      </InlineNotice>
    );
  }
  // The state goes along, so a Records row that lands on a copy still offers "Back to Records".
  if (resolution.kind === "redirect") return <Navigate replace to={exercisePath(resolution.to)} state={location.state} />;

  const fromRecords = (location.state as { from?: unknown } | null)?.from === "records";
  const back = fromRecords ? (
    <BackLink to={RECORDS_PATH} label={EXERCISES_COPY.backToRecords} />
  ) : (
    <BackLink to={EXERCISES_PATH} label={EXERCISES_COPY.backToExercises} />
  );

  if (resolution.kind === "deleted") {
    const title = (records.data ? groupByExercise(records.data)[0]?.name : undefined) ?? EXERCISES_COPY.removedExercise;
    return (
      <Screen title={title} lead={back}>
        <p className={styles.line}>{EXERCISES_COPY.deleted}</p>
        {statusLine}
        <ExerciseProgressBody exerciseId={exerciseId} />
      </Screen>
    );
  }

  return (
    <Screen title={resolution.row.name} lead={back} titleRef={titleRef}>
      <ExerciseDetails row={resolution.row} />
      <ExerciseActions row={resolution.row} onStatus={setStatus} onDelete={() => undefined} />
      {statusLine}
      {neverLogged ? <p className={styles.line}>{EXERCISES_COPY.neverLogged}</p> : <ExerciseProgressBody exerciseId={exerciseId} />}
    </Screen>
  );
}
