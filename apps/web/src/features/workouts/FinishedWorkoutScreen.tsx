import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import { FROM_HOME, deletedHere, editEntryState, isFromHome } from "./summaryEntry";
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
import { hasOwnTitle, WorkoutText } from "./WorkoutText";
import { EDIT_AFTER_SEND, NOT_DURABLE, SAVED_ELSEWHERE, SAVED_OFFLINE, SAVED_SLOW, SENT } from "./messages";
import { useLandedStore } from "./outbox/LandedStoreContext";
import { useOutboxState } from "./outbox/OutboxContext";
import { useViewingSummary } from "./summaryViewing";
import { useWaitingFinish } from "./useWaitingFinish";

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
 * `/app/history/:id` (`section="history"`) and adds the records the workout holds. `workoutId` wins over the
 * route's `:id` (Spec 17.12 AC15): History's index passes the newest workout's id at desktop widths, where
 * `/app/history` has no id of its own.
 */
export function FinishedWorkoutScreen({ section = "workouts", workoutId }: { section?: SummarySection; workoutId?: string }) {
  const home = SECTION_HOME[section];
  const params = useParams();
  const location = useLocation();
  const id = workoutId ?? params.id ?? "";
  const detail = useWorkoutDetail(id);
  const queryClient = useQueryClient();
  const finished = detail.data !== undefined && detail.data.endedAt !== null;
  // Spec 06.7 AC27: while this summary is open, a landing updates it in place and leaves no one-time line; opening it
  // by any route takes that workout's line away.
  useViewingSummary(id);
  // Spec 06.7 AC29: a refused finish leaves the workout live; the summary can't stay on it.
  const refusedHere = useWaitingFinish(id).failed;
  const landed = useLandedStore();
  useEffect(() => {
    landed?.clearWorkout(id);
  }, [landed, id]);

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

  if (refusedHere) return <Navigate to="/app/workouts" replace />;
  if (detail.isPending) return <Spinner label="Loading your workout…" />;

  // Minors 235, 238: the load error is classified once, as on the edit screen. A gone workout is gone even with a
  // cached copy.
  const failure = detail.isError ? classifyWorkoutError(detail.error, { op: "load-workout" }) : null;
  // Minor 716: a summary opened from its list (`fromHome`) whose workout this tab deleted is the entry the delete left
  // behind when it went Back (minor 696), so Forward lands on the list. Minor 770: a workout gone for another reason
  // (deleted on another device), or a summary reached any other way, still says Not found.
  if (failure?.kind === "not-found") {
    return isFromHome(location.state) && deletedHere(id) ? <Navigate to={home.to} replace /> : <NotFound />;
  }
  // Spec 18.0 (final review #1): a failed *refresh* keeps the cached workout on screen (the edit screen's re-reads on
  // focus make that common); only a failure with nothing cached replaces the summary.
  if (failure !== null && detail.data === undefined) {
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
  // Spec 06.7 AC24: "is it in the cloud" comes from the ops, never from `endedAt` (§6.11).
  const { waiting } = useWaitingFinish(workout.id);
  // Spec 06.7 AC34: arriving from a Finish tap that saved it on the phone, focus goes to the heading (the message
  // under it is a polite region, read after).
  // The tap's reason is read once and then cleared: a browser router keeps it in history state, so a reload or Back
  // would otherwise say "no signal" again and move focus again (final review). Later wording comes from the outbox.
  const location = useLocation();
  const routeId = useParams().id;
  const [tapped] = useState(() => (location.state as { saved?: "offline" | "slow" } | null)?.saved);
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (tapped === undefined) return;
    titleRef.current?.focus();
    // Minor 696: the list mark stays, so a delete here still goes Back to the list.
    void navigate(`${location.pathname}${location.search}`, { replace: true, state: isFromHome(location.state) ? FROM_HOME : null });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on arrival
  }, []);
  const home = SECTION_HOME[section];
  const date = formatLocalDate(workout.localDate);
  const setCount = workout.exercises.reduce((n, e) => n + e.sets.length, 0);
  const segments = sectionSegments(supersetRows(workout.exercises), workout.sections);

  return (
    <Screen
      title="Workout summary"
      titleRef={titleRef}
      titleSmall={hasOwnTitle(workout)}
      leadFill
      lead={
        <SummaryTop home={home} waiting={waiting}>
          {(open) => (
            <>
              {/* Spec 17.6 AC22 (D7): Edit workout is a menu item above Delete; navigation only, no request. */}
              {open ? (
                <Button variant="secondary" onClick={() =>
                    void navigate(`/app/${section}/${workout.id}/edit`, {
                      state: editEntryState(routeId, workout.id, location.state),
                    })
                  }
                >
                  Edit workout
                </Button>
              ) : null}
              <DeleteWorkoutControl workoutId={workout.id} setCount={setCount} afterDelete={home.to} showButton={open} />
            </>
          )}
        </SummaryTop>
      }
    >
      {/* Spec 18.0 AC50: the workout's own title and notes, only when set (no placeholder here). */}
      {workout.title !== null && hasOwnTitle(workout) ? <WorkoutText text={workout.title} variant="title" /> : null}
      <p className={styles.meta}>{date}</p>
      {workout.routineName === null ? null : <p className={styles.meta}>From routine: {workout.routineName}</p>}
      <SavedMessage workoutId={workout.id} endedAt={endedAt} waiting={waiting} tapped={tapped} />
      {/* Spec 17.6 AC21: records, stats, workout notes, exercises, the Hevy block, then the routine note. Spec 06.7 AC24:
          no records and no Hevy while the finish waits — the cloud doesn't have it yet. */}
      {waiting ? null : <PersonalRecordsBlock workoutId={workout.id} unitPreference={me?.unitPreference ?? "kg"} workout={workout} section={section} />}
      <FinishStats stats={finishStatsFor(workout, endedAt)} unitPreference={me?.unitPreference ?? "kg"} />
      {workout.notes === null ? null : (
        <section className={styles.workoutNotes} aria-label="Workout notes">
          <p className={styles.notesLabel}>Notes</p>
          <WorkoutText text={workout.notes} variant="notes" />
        </section>
      )}
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
            <SessionSection key={segment.key} heading={segment.heading} notes={segment.notes} timing={segment.timing}>
              {body}
            </SessionSection>
          );
        })}
      </div>
      {/* Spec 17.6 AC24 (D7): after the exercises, unchanged; the owner's only (renders nothing for anyone else). */}
      {waiting ? null : <HevyWorkoutSection workout={workout} />}
      {/* Spec 17.6 AC23: last, as plain text under a muted label, only when set. */}
      {workout.routineNotes ? (
        <section className={styles.workoutNotes} aria-label="Routine note">
          <p className={styles.notesLabel}>Routine note</p>
          <p className={styles.routineNotes}>{workout.routineNotes}</p>
        </section>
      ) : null}
    </Screen>
  );
}

/**
 * #107: the way back and the rare actions lead the screen, so a long workout needs no scroll to leave it. Back on
 * the left, the Workout menu on the right; its items (Edit workout, then Delete workout, Spec 17.6 AC22) revealed below, full width, as on the live
 * session's menu (Spec 17.1 D13: an inline disclosure, no popover). Only the item follows `open`: the control's
 * dialog, notice and in-flight lock stay mounted, so closing the menu never drops a failure or a pending delete.
 */
function SummaryTop({ home, waiting, children }: { home: { to: string; label: string }; waiting: boolean; children: (open: boolean) => ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={styles.top}>
      <div className={styles.topRow}>
        <BackLink to={home.to} label={home.label} />
        {/* Spec 06.7 AC24: no Workout menu (Edit, Delete) while the finish waits; the line says when it comes back. */}
        {waiting ? (
          <p className={styles.editAfterSend}>{EDIT_AFTER_SEND}</p>
        ) : (
          <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
            Workout menu
          </Button>
        )}
      </div>
      {waiting ? null : children(open)}
    </div>
  );
}

/**
 * Spec 06.7 AC23, AC25, AC28, AC34, D15: one polite status region, mounted from first paint and kept across the change
 * of state, so each change is announced once. While the finish waits: the saved-on-phone message (`NOT_DURABLE` when
 * the phone can't keep it, re-read live; else the tap's reason from the router state, or — after a reload — offline or
 * online wording from the outbox). Once a finish this screen saw waiting lands: "Sent to the cloud.", or
 * `SAVED_ELSEWHERE` when the server's end time isn't the one this phone sent.
 */
function SavedMessage({ workoutId, endedAt, waiting, tapped }: { workoutId: string; endedAt: string; waiting: boolean; tapped: "offline" | "slow" | undefined }) {
  const { durable, online } = useOutboxState();
  const { op } = useWaitingFinish(workoutId);
  const [sentAt, setSentAt] = useState<string | null>(waiting ? (op?.body.endedAt ?? null) : null);
  useEffect(() => {
    if (waiting && op) setSentAt(op.body.endedAt);
  }, [waiting, op]);
  let text = "";
  if (waiting) {
    const reason = tapped ?? (online ? "slow" : "offline");
    text = !durable ? NOT_DURABLE : reason === "slow" ? SAVED_SLOW : SAVED_OFFLINE;
  } else if (sentAt !== null) {
    text = Date.parse(endedAt) === Date.parse(sentAt) ? SENT : SAVED_ELSEWHERE;
  }
  return (
    <p className={styles.saved} role="status" data-testid="finish-saved">
      {text}
    </p>
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
 * Its own component, so the mutation's state changes re-render only this control. The screen still re-renders
 * during a delete (the outbox's readers hear `dropWorkout`), which is safe because the mutation removes this
 * workout's detail and records only once nothing observes them (`removeWhenUnobserved`): a removed query that is
 * still observed would be rebuilt and refetched (a 404, then Not found) before the navigation lands.
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
  const { pathname, state } = useLocation();
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
      // Spec 17.12 AC18: at desktop widths `/app/history` shows its newest workout itself, so a delete from there is
      // already where it lands: replace, or Back would land on the same page again. Minor 654: a delete from the deleted
      // workout's own page under it (`/app/history/:id`) replaces too, or Back would land on Not found.
      // Minor 696: a summary opened from its section's list (History's row, or Workouts' Finish and waiting card) goes
      // Back to that list instead, so the stack doesn't hold the list twice and the first Back isn't lost.
      if (isFromHome(state)) void navigate(-1);
      else void navigate(afterDelete, { replace: pathname === afterDelete || pathname.startsWith(`${afterDelete}/`) });
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
      {showButton ? (
        <Button variant="danger" onClick={() => setOpen(true)}>
          Delete workout
        </Button>
      ) : null}
      {/* After the menu's items (minor 484): drawn between Edit workout and Delete, it read as Edit's error. */}
      {error ? (
        <InlineNotice tone="error" requestId={error.requestId} actionLabel="Try again" onAction={() => void confirm()}>
          {error.text}
        </InlineNotice>
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
