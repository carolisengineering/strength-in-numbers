// apps/web/src/features/routines/RoutinePreview.tsx
import { useEffect } from "react";
import { Link, useParams } from "react-router";
import type { Routine } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { useExerciseLookup } from "./exerciseLookup";
import { ItemLine } from "./ItemLine";
import { LOAD_ONE_FAILED, ROUTINE_GONE } from "./messages";
import { routineEditPath, WORKOUTS_PATH } from "./paths";
import { useRoutine } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { runPosition } from "./routineDraft";
import { classifyRoutineError } from "./routineErrors";
import styles from "./RoutinePreview.module.css";
import { itemAccessibleName, targetLine } from "./targetFormat";

/** `/app/workouts/routines/:id` — keyed by id, so moving between routines mounts a fresh preview (one start key each). */
export function RoutinePreviewRoute() {
  const { id = "" } = useParams();
  return <RoutinePreview key={id} id={id} />;
}

function RoutinePreview({ id }: { id: string }) {
  const lookup = useRoutine(id);
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
  return <PreviewBody routine={lookup.routine} />;
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

function PreviewBody({ routine }: { routine: Routine }) {
  return (
    <Screen title={routine.name}>
      {routine.notes ? <p className={styles.notes}>{routine.notes}</p> : null}
      <RoutineItems routine={routine} />
      <div className={styles.actions}>
        <Link className={styles.secondary} to={routineEditPath(routine.id)}>
          Edit
        </Link>
      </div>
      <BackLink />
    </Screen>
  );
}
