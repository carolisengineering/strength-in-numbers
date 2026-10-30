import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import type { WorkoutDetail } from "@sin/core";

import { BackLink } from "../../ui/BackLink";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { NotFound } from "../../screens/NotFound";
import { useMe } from "../me/useMe";
import { HevyDeleteNote, HevyWorkoutSection } from "../hevy/send";
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
import { WorkoutText } from "./WorkoutText";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Which nav section the summary was opened from (Spec 08.0 AC20): only the back link and the post-delete redirect differ. */
export type SummarySection = "workouts" | "history";

export const SECTION_HOME: Record<SummarySection, { to: string; label: string }> = {
  workouts: { to: "/app/workouts", label: "Back to Workouts" },
  history: { to: "/app/history", label: "Back to History" },
};

/**
 * A finished workout, read-only (Spec 06.1 §5.7, D18), and the only way to undo a mistaken Finish
 * (delete it — Spec 05.0 §6.5's one exemption from immutability). Spec 08.0 reuses this screen as
 * `/app/history/:id` (`section="history"`) and adds the records the workout holds.
 */
export function FinishedWorkoutScreen({ section = "workouts" }: { section?: SummarySection }) {
  const home = SECTION_HOME[section];
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

  // Spec 18.0 (final review #1): a failed *refresh* keeps the cached workout on screen (the edit screen's re-reads on
  // focus make that common); only a failure with nothing cached replaces the summary.
  if (detail.isError && (detail.data === undefined || classifyWorkoutError(detail.error).kind === "not-found")) {
    const failure = classifyWorkoutError(detail.error, { op: "load-workout" });
    if (failure.kind === "not-found") return <NotFound />;
    return (
      <Screen title="Workout summary" lead={<BackLink to={home.to} label={home.label} />}>
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
  const workout = detail.data;
  if (workout === undefined) return null; // unreachable: no data with no error is the pending state above
  if (workout.endedAt === null) return <Navigate to="/app/workouts" replace />;

  return <Summary workout={workout} endedAt={workout.endedAt} section={section} />;
}

function Summary({ workout, endedAt, section }: { workout: WorkoutDetail; endedAt: string; section: SummarySection }) {
  const { data: me } = useMe();
  const navigate = useNavigate();
  const home = SECTION_HOME[section];
  const date = formatLocalDate(workout.localDate);
  const setCount = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const segments = sectionSegments(supersetRows(workout.exercises), workout.sections);

  return (
    <Screen
      title="Workout summary"
      leadFill
      lead={
        <SummaryTop home={home}>
          {(open) => <DeleteWorkoutControl workoutId={workout.id} setCount={setCount} afterDelete={home.to} showButton={open} />}
        </SummaryTop>
      }
    >
      {/* Spec 18.0 AC50: the workout's own title and notes, only when set (no placeholder here). */}
      {workout.title === null ? null : <WorkoutText text={workout.title} variant="title" />}
      <p className={styles.meta}>{date}</p>
      {workout.routineName === null ? null : <p className={styles.meta}>From routine: {workout.routineName}</p>}
      {workout.routineNotes ? <p className={styles.routineNotes}>{workout.routineNotes}</p> : null}
      {workout.notes === null ? null : (
        <section className={styles.workoutNotes} aria-label="Workout notes">
          <p className={styles.notesLabel}>Notes</p>
          <WorkoutText text={workout.notes} variant="notes" />
        </section>
      )}
      <FinishStats stats={finishStatsFor(workout, endedAt)} unitPreference={me?.unitPreference ?? "kg"} />
      {/* Spec 18.0 AC1 / D11: at the top, under the stats; navigation only, no request. */}
      <div className={styles.editRow}>
        <Button variant="secondary" onClick={() => void navigate(`/app/${section}/${workout.id}/edit`)}>
          Edit workout
        </Button>
      </div>
      {/* Spec 20.2 AC1 / D13: under the stats and Edit workout; the owner's only (renders nothing for anyone else). */}
      <HevyWorkoutSection workout={workout} />
      <PersonalRecordsBlock workoutId={workout.id} unitPreference={me?.unitPreference ?? "kg"} workout={workout} />
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
    </Screen>
  );
}

/**
 * #107: the way back and the rare actions lead the screen, so a long workout needs no scroll to leave it. Back on
 * the left, the Workout menu on the right; its items (Delete workout) revealed below, full width, as on the live
 * session's menu (Spec 17.1 D13: an inline disclosure, no popover). Only the item follows `open`: the control's
 * dialog, notice and in-flight lock stay mounted, so closing the menu never drops a failure or a pending delete.
 */
function SummaryTop({ home, children }: { home: { to: string; label: string }; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.top}>
      <div className={styles.topRow}>
        <BackLink to={home.to} label={home.label} />
        <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
          Workout menu
        </Button>
      </div>
      {children(open)}
    </div>
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
  showButton,
}: {
  workoutId: string;
  setCount: number;
  /** Where a successful delete lands: the section the summary was opened from (Spec 08.0 AC20). */
  afterDelete: string;
  /** #107: the Delete button shows only while the Workout menu is open; everything else stays mounted. */
  showButton: boolean;
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
      {showButton ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete workout
        </Button>
      ) : null}
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
        <HevyDeleteNote workoutId={workoutId} open={open} />
      </ConfirmDialog>
    </>
  );
}
