import { lineageRootId } from "@sin/core";
import { Navigate, useLocation, useParams } from "react-router";

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
import { ExerciseDetails } from "./ExerciseDetails";
import styles from "./ExerciseScreen.module.css";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, exercisePath, RECORDS_PATH } from "./paths";
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
  if (resolution.kind === "redirect") return <Navigate replace to={exercisePath(resolution.to)} />;

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
        <ExerciseProgressBody exerciseId={exerciseId} />
      </Screen>
    );
  }

  return (
    <Screen title={resolution.row.name} lead={back}>
      <ExerciseDetails row={resolution.row} />
      {neverLogged ? <p className={styles.line}>{EXERCISES_COPY.neverLogged}</p> : <ExerciseProgressBody exerciseId={exerciseId} />}
    </Screen>
  );
}
