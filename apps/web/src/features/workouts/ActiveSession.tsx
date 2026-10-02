import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Exercise, WorkoutDetail, WorkoutExerciseDetail } from "@sin/core";

import { useSession } from "../../auth/useSession";
import { track } from "../../observability/track";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { ExercisePicker } from "../catalog/ExercisePicker";
import { useCatalog } from "../catalog/useCatalog";
import { ExerciseCard } from "./ExerciseCard";
import { WORKOUT_KEYS } from "./queries";
import { resolveFailure, type Operation } from "./sessionErrors";
import { useAddExercise, useMoveExercise, useRemoveExercise } from "./useWorkoutMutations";
import styles from "./ActiveSession.module.css";

export interface ActiveSessionProps {
  workout: WorkoutDetail;
  /** A one-line message carried over from another screen (e.g. "…resumed it."). */
  notice?: string | null;
  /** The workout is gone or finished elsewhere: hand back to the Workouts screen (§5.8 gone path). */
  onGone: () => void;
}

interface Banner {
  tone: "info" | "warning" | "error";
  text: string;
  requestId?: string | null;
  retry?: () => void;
}

const startedTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The in-progress workout (Spec 06.1 §5.3): exercise cards, a sticky action bar, the exercise picker.
 * Exercise-structure writes (add / move / remove) are serialised: each changes sibling `position`s,
 * and the next move's arithmetic comes from the list on screen, so one write plus its refetch at a
 * time (§6.3).
 */
export function ActiveSession({ workout, notice, onGone }: ActiveSessionProps) {
  const queryClient = useQueryClient();
  const { user } = useSession();
  const catalog = useCatalog();
  const add = useAddExercise();
  const move = useMoveExercise();
  const remove = useRemoveExercise();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string } | null>(null);
  const [removing, setRemoving] = useState<WorkoutExerciseDetail | null>(null);
  const [banner, setBanner] = useState<Banner | null>(null);
  // Synchronous guard: React state would not have updated before a second tap lands.
  const structureLock = useRef(false);

  const exercises = useMemo(
    () => [...workout.exercises].sort((a, b) => a.position - b.position),
    [workout.exercises],
  );
  const totalSets = exercises.reduce((n, e) => n + e.sets.length, 0);
  const structureBusy = add.isPending || move.isPending || remove.isPending || pending !== null;

  const refetchActive = () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });

  /** Resolve a failed exercise-structure write per §5.8. */
  async function handleFailure(op: Operation, error: unknown, retry?: () => void) {
    const action = resolveFailure(op, error);
    switch (action.type) {
      case "gone":
        track("workout_conflict", { kind: action.reason });
        onGone();
        return;
      case "ok":
        return;
      case "refetch":
        track("workout_conflict", { kind: "stale-position" });
        await refetchActive();
        return;
      case "unavailable": {
        // The API answers 404 both for "workout gone" and "exercise not visible": refetch to tell.
        await refetchActive();
        const current = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
        if (!current || current.id !== workout.id) {
          track("workout_conflict", { kind: "gone" });
          onGone();
        } else {
          track("workout_conflict", { kind: "unavailable" });
          setBanner({ tone: "warning", text: "That exercise isn't available" });
          void catalog.refresh(true);
        }
        return;
      }
      case "retired":
        track("workout_conflict", { kind: "retired" });
        setBanner({ tone: "warning", text: "That exercise has been retired and can't be added" });
        void catalog.refresh(true);
        return;
      case "unconfirmed":
        await refetchActive();
        setBanner({ tone: "warning", text: action.text, requestId: action.requestId });
        return;
      default: {
        const text = action.type === "retry" ? action.text : "Something went wrong — try again";
        const requestId = "requestId" in action ? action.requestId : null;
        setBanner({ tone: "error", text, requestId, ...(retry ? { retry } : {}) });
      }
    }
  }

  async function addExercise(exercise: Exercise) {
    if (structureLock.current) return;
    structureLock.current = true;
    setBanner(null);
    setPickerOpen(false);
    setPending({ name: exercise.name });
    try {
      await add.mutateAsync({ workoutId: workout.id, exerciseId: exercise.id, modality: exercise.modality });
    } catch (error) {
      await handleFailure("add-exercise", error);
    } finally {
      setPending(null);
      structureLock.current = false;
    }
  }

  async function moveExercise(exercise: WorkoutExerciseDetail, direction: "up" | "down") {
    if (structureLock.current) return;
    structureLock.current = true;
    setBanner(null);
    try {
      await move.mutateAsync({
        id: exercise.id,
        position: exercise.position + (direction === "up" ? -1 : 1),
        direction,
      });
    } catch (error) {
      await handleFailure("move-exercise", error, () => void moveExercise(exercise, direction));
    } finally {
      structureLock.current = false;
    }
  }

  async function removeExercise(exercise: WorkoutExerciseDetail) {
    if (structureLock.current) return;
    structureLock.current = true;
    setBanner(null);
    setRemoving(null);
    try {
      await remove.mutateAsync({ id: exercise.id, setCount: exercise.sets.length });
    } catch (error) {
      await handleFailure("remove-exercise", error, () => void removeExercise(exercise));
    } finally {
      structureLock.current = false;
    }
  }

  const shown: Banner | null = banner ?? (notice ? { tone: "info", text: notice } : null);

  return (
    <Screen title="Workout">
      <p className={styles.started}>Started {startedTime(workout.startedAt)}</p>

      {shown ? (
        <InlineNotice
          tone={shown.tone}
          requestId={shown.requestId}
          {...(shown.retry
            ? {
                actionLabel: "Try again",
                onAction: () => {
                  const retry = shown.retry;
                  setBanner(null);
                  retry?.();
                },
              }
            : {})}
        >
          {shown.text}
        </InlineNotice>
      ) : null}

      <div className={styles.cards}>
        {exercises.length === 0 && pending === null ? (
          <p className={styles.hint}>Add your first exercise</p>
        ) : null}
        {exercises.map((exercise, index) => (
          <ExerciseCard
            key={exercise.id}
            exercise={exercise}
            isFirst={index === 0}
            isLast={index === exercises.length - 1}
            structureBusy={structureBusy}
            onMove={(direction) => void moveExercise(exercise, direction)}
            onRemove={() => (exercise.sets.length === 0 ? void removeExercise(exercise) : setRemoving(exercise))}
            unitPreference={user?.unitPreference ?? "kg"}
            onGone={() => {
              track("workout_conflict", { kind: "gone" });
              onGone();
            }}
          />
        ))}
        {pending ? (
          <div className={styles.placeholder} aria-busy="true">
            <p>Adding {pending.name}…</p>
          </div>
        ) : null}
      </div>

      <div className={styles.bar} data-testid="session-bar">
        <Button variant="secondary" disabled={structureBusy} onClick={() => setPickerOpen(true)}>
          Add exercise
        </Button>
        <Button disabled={totalSets === 0}>Finish</Button>
        {totalSets === 0 ? <p className={styles.barHint}>Log at least one set to finish</p> : null}
      </div>

      <ExercisePicker open={pickerOpen} onPick={(exercise) => void addExercise(exercise)} onClose={() => setPickerOpen(false)} />

      <ConfirmDialog
        open={removing !== null}
        title={removing ? `Remove ${removing.exerciseNameSnapshot}?` : "Remove exercise?"}
        confirmLabel="Remove"
        variant="danger"
        onConfirm={() => removing && void removeExercise(removing)}
        onCancel={() => setRemoving(null)}
      >
        <p>
          {removing ? `${removing.sets.length} ${removing.sets.length === 1 ? "set" : "sets"} will be deleted.` : null}
        </p>
      </ConfirmDialog>
    </Screen>
  );
}
