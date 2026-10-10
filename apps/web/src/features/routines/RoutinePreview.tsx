import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Routine } from "@sin/core";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { useActiveWorkout } from "../workouts/queries";
import { START_CLOCK_MESSAGE, START_FAILED_MESSAGE, useBeginWorkout } from "../workouts/useBeginWorkout";
import type { WorkoutsLocationState } from "../workouts/WorkoutsScreen";
import { useExerciseLookup } from "./exerciseLookup";
import { ItemLine } from "./ItemLine";
import { ACTIVE_BLOCKS_START, DELETE_FAILED, LOAD_ONE_FAILED, OFFLINE_DELETE, RATE_LIMITED, ROUTINE_GONE, START_RETIRED } from "./messages";
import { EDITOR_FROM_BACK, routineEditPath, WORKOUTS_PATH } from "./paths";
import { ROUTINE_KEYS, useRoutine } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { runPosition } from "./routineDraft";
import { classifyRoutineError, type ClassifiedRoutineError } from "./routineErrors";
import styles from "./RoutinePreview.module.css";
import { itemAccessibleName, targetLine } from "./targetFormat";
import { useDeleteRoutine } from "./useRoutineMutations";

/** `/app/workouts/routines/:id` — keyed by id, so moving between routines mounts a fresh preview (one start key each). */
export function RoutinePreviewRoute() {
  const { id = "" } = useParams();
  return <RoutinePreview key={id} id={id} />;
}

function RoutinePreview({ id }: { id: string }) {
  const remove = useDeleteRoutine();
  // While deleting / deleted the id is about to vanish: never fall back to a detail read for it (§6.4).
  const lookup = useRoutine(id, { suspend: remove.isPending || remove.isSuccess });
  const error = lookup.status === "error" ? lookup.error : null;

  useEffect(() => {
    if (error) reportRoutineUnexpected("load-routine", error);
  }, [error]);

  if (lookup.status === "pending") {
    return (
      <Screen title="Routine">
        <p role="status" className={styles.status}>
          Loading routine…
        </p>
      </Screen>
    );
  }
  if (lookup.status === "not-found") return <RoutineGone />;
  if (lookup.status === "error") {
    return (
      <Screen title="Routine">
        <InlineNotice tone="error" requestId={classifyRoutineError(lookup.error).requestId} actionLabel="Retry" onAction={lookup.retry}>
          {LOAD_ONE_FAILED}
        </InlineNotice>
        <BackLink />
      </Screen>
    );
  }
  return <PreviewBody routine={lookup.routine} remove={remove} />;
}

export function RoutineGone() {
  return (
    <Screen title="Routine">
      <p className={styles.status}>{ROUTINE_GONE}</p>
      <BackLink />
    </Screen>
  );
}

function BackLink() {
  return (
    <Link className={styles.back} to={WORKOUTS_PATH}>
      Back to Workouts
    </Link>
  );
}

export function RoutineItems({ routine }: { routine: Routine }) {
  const lookupExercise = useExerciseLookup();
  const items = [...routine.items].sort((a, b) => a.position - b.position);
  const groups = items.map((i) => i.supersetGroup);
  return (
    <ul className={styles.items} aria-label="Exercises">
      {items.map((item, index) => {
        const exercise = lookupExercise(item.exerciseId);
        const position = runPosition(groups, index);
        const group = position === "none" ? null : item.supersetGroup;
        const line = targetLine(item);
        const unavailable = exercise.state === "retired" || exercise.state === "missing";
        return (
          <li key={item.id} className={styles.item} aria-label={itemAccessibleName(exercise.name, group, line, unavailable)}>
            <ItemLine name={exercise.name} line={line} notes={item.notes} position={position} unavailable={unavailable} />
          </li>
        );
      })}
    </ul>
  );
}

function deleteMessage(failure: ClassifiedRoutineError): string {
  if (failure.kind === "network") return OFFLINE_DELETE;
  if (failure.kind === "rate-limited") return RATE_LIMITED;
  return DELETE_FAILED;
}

function PreviewBody({ routine, remove }: { routine: Routine; remove: ReturnType<typeof useDeleteRoutine> }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const active = useActiveWorkout();
  const { begin, busy, failure } = useBeginWorkout({ routineId: routine.id });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<ClassifiedRoutineError | null>(null);
  const forgetOnUnmount = useRef<(() => void) | null>(null);
  useEffect(() => () => forgetOnUnmount.current?.(), []);

  const goToWorkouts = (state?: WorkoutsLocationState) =>
    navigate(WORKOUTS_PATH, state === undefined ? { replace: true } : { replace: true, state });

  async function onStart() {
    const outcome = await begin();
    if (outcome === null) return;
    if (outcome.kind === "started") goToWorkouts();
    else if (outcome.kind === "resumed") goToWorkouts({ notice: "routine-not-applied" });
    else if (outcome.failure.kind === "not-found") {
      // Forget the routine only once this preview unmounts: cleared earlier, a list refetch could land
      // first and flash this screen's own "gone" state before the navigation renders.
      const goneId = routine.id;
      forgetOnUnmount.current = () => {
        queryClient.removeQueries({ queryKey: ROUTINE_KEYS.detail(goneId), exact: true });
        void queryClient.invalidateQueries({ queryKey: ROUTINE_KEYS.list });
      };
      goToWorkouts({ notice: "routine-gone" });
    }
  }

  async function onConfirmDelete() {
    setDeleteFailure(null);
    try {
      await remove.mutateAsync(routine.id);
      setConfirmOpen(false);
      goToWorkouts();
    } catch (caught) {
      reportRoutineUnexpected("delete-routine", caught);
      setConfirmOpen(false);
      setDeleteFailure(classifyRoutineError(caught));
    }
  }

  const startFailure =
    failure === null || failure.kind === "not-found"
      ? null
      : failure.kind === "exercise-retired"
        ? { text: START_RETIRED, action: "edit" as const }
        : { text: failure.kind === "validation" ? START_CLOCK_MESSAGE : START_FAILED_MESSAGE, action: "retry" as const };

  return (
    <Screen title={routine.name}>
      {routine.notes ? <p className={styles.notes}>{routine.notes}</p> : null}
      <RoutineItems routine={routine} />
      {startFailure ? (
        <InlineNotice
          tone="error"
          requestId={failure?.requestId ?? null}
          actionLabel={startFailure.action === "edit" ? "Edit" : "Try again"}
          onAction={() => (startFailure.action === "edit" ? navigate(routineEditPath(routine.id), { state: EDITOR_FROM_BACK }) : void onStart())}
        >
          {startFailure.text}
        </InlineNotice>
      ) : null}
      {deleteFailure ? (
        <InlineNotice tone="error" requestId={deleteFailure.kind === "network" ? null : deleteFailure.requestId}>
          {deleteMessage(deleteFailure)}
        </InlineNotice>
      ) : null}
      <div className={styles.actions}>
        {active.data ? (
          <p className={styles.blocked}>
            {ACTIVE_BLOCKS_START}{" "}
            <Link className={styles.secondary} to={WORKOUTS_PATH}>
              Go to your workout
            </Link>
          </p>
        ) : (
          <Button block busy={busy} onClick={() => void onStart()}>
            Start this routine
          </Button>
        )}
        <Link className={styles.secondary} to={routineEditPath(routine.id)} state={EDITOR_FROM_BACK}>
          Edit
        </Link>
        <Button variant="danger" onClick={() => setConfirmOpen(true)}>
          Delete
        </Button>
      </div>
      <BackLink />
      <ConfirmDialog
        open={confirmOpen}
        title={`Delete ${routine.name}?`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        variant="danger"
        busy={remove.isPending}
        onConfirm={() => void onConfirmDelete()}
        onCancel={() => setConfirmOpen(false)}
      >
        Past workouts keep their history.
      </ConfirmDialog>
    </Screen>
  );
}
