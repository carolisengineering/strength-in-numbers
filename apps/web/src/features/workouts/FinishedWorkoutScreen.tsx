import { Fragment, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import type { WorkoutDetail } from "@sin/core";

import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { NotFound } from "../../screens/NotFound";
import { useMe } from "../me/useMe";
import { PersonalRecordsBlock } from "../records/PersonalRecordsBlock";
import { SupersetBracket } from "../routines/SupersetBracket";
import { classifyWorkoutError } from "./errors";
import { formatLocalDate } from "./format";
import { finishStatsFor } from "./finishStats";
import { FinishStats } from "./FinishStatsList";
import { WORKOUT_KEYS, useWorkoutDetail } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { resolveFailure } from "./sessionErrors";
import { sectionSegments } from "./sectionSegments";
import { SessionSection } from "./SessionSectionHeading";
import { supersetRows, type SupersetRow } from "./supersetRows";
import { useDeleteWorkout } from "./useWorkoutMutations";
import styles from "./FinishedWorkoutScreen.module.css";
import { SetText, WarmupMark } from "./WarmupMark";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which nav section the summary was opened from (Spec 08.0 AC20): only the back link and the post-delete redirect differ. */
export type SummarySection = "workouts" | "history";

const SECTION_HOME: Record<SummarySection, { to: string; label: string }> = {
  workouts: { to: "/app/workouts", label: "Back to Workouts" },
  history: { to: "/app/history", label: "Back to History" },
};

/**
 * A finished workout, read-only (Spec 06.1 §5.7, D18), and the only way to undo a mistaken Finish
 * (delete it — Spec 05.0 §6.5's one exemption from immutability). Spec 08.0 reuses this screen as
 * `/app/history/:id` (`section="history"`) and adds the records the workout holds.
 */
export function FinishedWorkoutScreen({ section = "workouts" }: { section?: SummarySection }) {
  const { id = "" } = useParams();
  const detail = useWorkoutDetail(id);
  const queryClient = useQueryClient();
  const finished = detail.data !== undefined && detail.data.endedAt !== null;

  useEffect(() => {
    if (detail.error) reportUnexpected("load-workout", detail.error);
  }, [detail.error]);

  // The finish flow leaves the active entry in place so the Workouts screen keeps its session until
  // the route changes (Spec 06.4 D1). Here no observer of it is mounted, so it can go. Only if it is
  // this workout: Spec 08.0 opens this screen from History while another workout may be in progress.
  useEffect(() => {
    if (!finished) return;
    if (queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active)?.id === id) {
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.active });
    }
  }, [finished, id, queryClient]);

  if (detail.isPending) return <Spinner label="Loading your workout…" />;

  if (detail.isError) {
    const failure = classifyWorkoutError(detail.error, { op: "load-workout" });
    if (failure.kind === "not-found") return <NotFound />;
    return (
      <Screen title="Workout summary">
        <InlineNotice
          tone="error"
          requestId={failure.requestId}
          actionLabel="Try again"
          onAction={() => void detail.refetch()}
        >
          Couldn't load this workout.
        </InlineNotice>
      </Screen>
    );
  }

  // An in-progress workout belongs on the session screen.
  if (detail.data.endedAt === null) return <Navigate to="/app/workouts" replace />;

  return <Summary workout={detail.data} endedAt={detail.data.endedAt} section={section} />;
}

function Summary({ workout, endedAt, section }: { workout: WorkoutDetail; endedAt: string; section: SummarySection }) {
  const { data: me } = useMe();
  const home = SECTION_HOME[section];
  const date = formatLocalDate(workout.localDate);
  const setCount = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const segments = sectionSegments(supersetRows(workout.exercises), workout.sections);

  return (
    <Screen title="Workout summary">
      <p className={styles.meta}>{date}</p>
      {workout.routineName === null ? null : <p className={styles.meta}>From routine: {workout.routineName}</p>}
      {workout.routineNotes ? <p className={styles.routineNotes}>{workout.routineNotes}</p> : null}
      <FinishStats stats={finishStatsFor(workout, endedAt)} unitPreference={me?.unitPreference ?? "kg"} />
      <PersonalRecordsBlock workoutId={workout.id} unitPreference={me?.unitPreference ?? "kg"} />
      <div className={styles.exercises}>
        {segments.map((segment) => {
          const body = segment.rows.map((row, k) => (
            <Fragment key={row.exercise.id}>
              <SummaryExercise row={row} />
              {k < segment.rows.length - 1 ? (
                <div className={styles.joint}>
                  <SupersetBracket position={row.linkedBelow ? "middle" : "none"} />
                </div>
              ) : null}
            </Fragment>
          ));
          return segment.heading === null ? (
            <Fragment key={segment.key}>{body}</Fragment>
          ) : (
            <SessionSection key={segment.key} heading={segment.heading} notes={segment.notes}>
              {body}
            </SessionSection>
          );
        })}
      </div>
      <div className={styles.actions}>
        <DeleteWorkoutControl workoutId={workout.id} setCount={setCount} afterDelete={home.to} />
        <Link className={styles.back} to={home.to}>
          {home.label}
        </Link>
      </div>
    </Screen>
  );
}

/** One exercise, read-only, with the routine's target line, notes and superset bracket (Spec 10.1 AC24). */
function SummaryExercise({ row: { exercise, bracket, line, label } }: { row: SupersetRow }) {
  const headingId = useId();
  return (
    <div className={bracket === "none" ? styles.slot : `${styles.slot} ${styles.grouped}`}>
      <SupersetBracket position={bracket} />
      <section className={styles.exercise} {...(label ? { "aria-label": label } : { "aria-labelledby": headingId })}>
        <h2 className={styles.name} id={headingId}>
          {exercise.exerciseNameSnapshot}
        </h2>
        {line === "" ? null : <p className={styles.target}>{line}</p>}
        {exercise.notes ? <p className={styles.notes}>{exercise.notes}</p> : null}
        <ol className={styles.sets}>
          {exercise.sets.map((set) => (
            <li key={set.id} className={set.setType === "warmup" ? `${styles.set} ${styles.warmup}` : styles.set} data-set-type={set.setType}>
              <span className={styles.setNumber}>{set.setNumber}</span>
              <WarmupMark setType={set.setType} />
              <SetText set={set} modality={exercise.modalitySnapshot} />
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/**
 * Its own component on purpose: the delete mutation removes this workout's cached detail, and a
 * component that also observes that query would rebuild it and refetch (a 404 flash) before the
 * navigation lands. Here the mutation's state changes re-render only this control.
 */
function DeleteWorkoutControl({
  workoutId,
  setCount,
  afterDelete,
}: {
  workoutId: string;
  setCount: number;
  /** Where a successful delete lands: the section the summary was opened from (Spec 08.0 AC20). */
  afterDelete: string;
}) {
  const navigate = useNavigate();
  const del = useDeleteWorkout();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<{ text: string; requestId: string | null } | null>(null);
  const lock = useRef(false);

  async function confirm() {
    if (lock.current) return;
    lock.current = true;
    setError(null);
    try {
      await del.mutateAsync({ id: workoutId, phase: "finished", setCount });
      setOpen(false);
      void navigate(afterDelete);
    } catch (caught) {
      setOpen(false);
      reportUnexpected("discard", caught);
      const action = resolveFailure("discard", caught);
      setError({
        text: "Couldn't delete the workout — try again",
        requestId: action.type === "retry" ? action.requestId : null,
      });
    } finally {
      lock.current = false;
    }
  }

  return (
    <>
      {error ? (
        <InlineNotice tone="error" requestId={error.requestId} actionLabel="Try again" onAction={() => void confirm()}>
          {error.text}
        </InlineNotice>
      ) : null}
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete workout
      </Button>
      <ConfirmDialog
        open={open}
        title="Delete this workout?"
        confirmLabel="Delete"
        variant="danger"
        busy={del.isPending}
        onConfirm={() => void confirm()}
        onCancel={() => setOpen(false)}
      >
        <p>
          This permanently deletes the workout and its {plural(setCount, "logged set", "logged sets")}.
        </p>
      </ConfirmDialog>
    </>
  );
}
