import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
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
import { findIncompleteWorkingSets } from "./incomplete";
import { WORKOUT_KEYS, useWorkoutClient } from "./queries";
import { resolveFailure, type Operation } from "./sessionErrors";
import { finishTimestamp } from "./timestamps";
import {
  useAddExercise,
  useDeleteWorkout,
  useFinishWorkout,
  useIsSetWritePending,
  useMoveExercise,
  useRemoveExercise,
} from "./useWorkoutMutations";
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

const CLOCK_MESSAGE = "Your device clock looks wrong — check the date and time, then try again.";
const EMPTY_IDS: ReadonlySet<string> = new Set();

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const startedTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });

/**
 * The in-progress workout (Spec 06.1 §5.3): exercise cards, a sticky action bar, the exercise picker,
 * Finish and Discard. Exercise-structure writes (add / move / remove) are serialised: each changes
 * sibling `position`s, and the next move's arithmetic comes from the list on screen, so one write plus
 * its refetch at a time (§6.3).
 */
export function ActiveSession({ workout, notice, onGone }: ActiveSessionProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const client = useWorkoutClient();
  const { user } = useSession();
  const catalog = useCatalog();
  const add = useAddExercise();
  const move = useMoveExercise();
  const remove = useRemoveExercise();
  const finish = useFinishWorkout();
  const discard = useDeleteWorkout();
  const setWritePending = useIsSetWritePending();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string } | null>(null);
  const [removing, setRemoving] = useState<WorkoutExerciseDetail | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [flaggedIds, setFlaggedIds] = useState<ReadonlySet<string>>(EMPTY_IDS);
  const [banner, setBanner] = useState<Banner | null>(null);
  // Synchronous guards: React state would not have updated before a second tap lands.
  const structureLock = useRef(false);
  const finishLock = useRef(false);
  const discardLock = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const exercises = useMemo(
    () => [...workout.exercises].sort((a, b) => a.position - b.position),
    [workout.exercises],
  );
  const totalSets = exercises.reduce((n, e) => n + e.sets.length, 0);
  const structureBusy = add.isPending || move.isPending || remove.isPending || pending !== null;

  // A flag lasts only while the set is still incomplete: fixing or deleting it clears the marker.
  const flagged = useMemo(() => {
    if (flaggedIds.size === 0) return EMPTY_IDS;
    return new Set(findIncompleteWorkingSets(workout).filter((id) => flaggedIds.has(id)));
  }, [flaggedIds, workout]);

  // Bring the first offending row into view when Finish is blocked (phones: the row may be offscreen).
  useEffect(() => {
    if (flaggedIds.size === 0) return;
    document.querySelector("[data-needs-data='true']")?.scrollIntoView?.({ block: "center" });
  }, [flaggedIds]);

  const refetchActive = () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });

  const gone = (reason: "gone" | "finished") => {
    track("workout_conflict", { kind: reason });
    onGone();
  };

  /** Resolve a failed exercise-structure write per §5.8. */
  async function handleFailure(op: Operation, error: unknown, retry?: () => void) {
    const action = resolveFailure(op, error);
    switch (action.type) {
      case "gone":
        gone(action.reason);
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
          gone("gone");
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

  // ---- finish (§5.6, §6.6) ---------------------------------------------------------------------

  /** `409 incomplete-working-sets` carries no ids (05.1 AC13), so reproduce the rule locally (D5). */
  async function diagnoseIncomplete() {
    await refetchActive();
    const fresh = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
    const ids = fresh ? findIncompleteWorkingSets(fresh) : [];
    track("finish_blocked", { incompleteCount: ids.length });
    setFlaggedIds(new Set(ids));
    setBanner({
      tone: "warning",
      text:
        ids.length > 0
          ? `${ids.length} working ${ids.length === 1 ? "set is" : "sets are"} missing data. Fix or delete them, then finish again.`
          : "Some sets are incomplete — reload and check your sets.",
    });
  }

  /** `409 workout-finished`: if the workout really is finished, our own finish landed (a lost first response). */
  async function confirmAlreadyFinished() {
    try {
      const fresh = await client.getById(workout.id);
      if (fresh.endedAt === null) {
        gone("gone");
        return;
      }
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.active });
      queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id), fresh);
      track("workout_finished", {
        exerciseCount: fresh.exercises.length,
        setCount: fresh.exercises.reduce((n, e) => n + e.sets.length, 0),
        durationMin: Math.round((Date.parse(fresh.endedAt) - Date.parse(fresh.startedAt)) / 60_000),
        viaReplay: true,
      });
      if (mounted.current) void navigate(`/app/workouts/${workout.id}`);
    } catch {
      setBanner({ tone: "error", text: "Couldn't finish — try again", retry: () => void confirmFinish() });
    }
  }

  async function confirmFinish() {
    if (finishLock.current) return;
    finishLock.current = true;
    setBanner(null);
    try {
      await finish.mutateAsync({ id: workout.id, endedAt: finishTimestamp(workout.startedAt, new Date()) });
      setFinishOpen(false);
      // Navigation stays out of the mutation hook: a response that lands after the lifter left this
      // screen must not yank them back across screens.
      if (mounted.current) void navigate(`/app/workouts/${workout.id}`);
    } catch (error) {
      setFinishOpen(false);
      const action = resolveFailure("finish", error);
      switch (action.type) {
        case "gone":
          gone(action.reason);
          break;
        case "incomplete":
          await diagnoseIncomplete();
          break;
        case "finished-check":
          await confirmAlreadyFinished();
          break;
        case "clock":
          track("workout_conflict", { kind: "clock" });
          setBanner({ tone: "error", text: CLOCK_MESSAGE, requestId: action.requestId });
          break;
        default:
          setBanner({
            tone: "error",
            text: action.type === "retry" ? action.text : "Couldn't finish — try again",
            requestId: "requestId" in action ? action.requestId : null,
            retry: () => void confirmFinish(),
          });
      }
    } finally {
      finishLock.current = false;
    }
  }

  // ---- discard (§5.7) ---------------------------------------------------------------------------

  async function confirmDiscard() {
    if (discardLock.current) return;
    discardLock.current = true;
    setBanner(null);
    try {
      await discard.mutateAsync({ id: workout.id, phase: "active", setCount: totalSets });
      setDiscardOpen(false);
    } catch (error) {
      setDiscardOpen(false);
      const action = resolveFailure("discard", error);
      setBanner({
        tone: "error",
        text: action.type === "retry" ? action.text : "Couldn't discard the workout — try again",
        requestId: "requestId" in action ? action.requestId : null,
        retry: () => void confirmDiscard(),
      });
    } finally {
      discardLock.current = false;
    }
  }

  const shown: Banner | null = banner ?? (notice ? { tone: "info", text: notice } : null);
  const finishDisabled = totalSets === 0 || setWritePending || structureBusy;

  return (
    <Screen title="Workout">
      <div className={styles.topRow}>
        <p className={styles.started}>Started {startedTime(workout.startedAt)}</p>
        {/* Away from the thumb on purpose, and it confirms: discarding deletes every logged set. */}
        <Button variant="secondary" onClick={() => setDiscardOpen(true)}>
          Discard workout
        </Button>
      </div>

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
            flaggedIds={flagged}
            onMove={(direction) => void moveExercise(exercise, direction)}
            onRemove={() => (exercise.sets.length === 0 ? void removeExercise(exercise) : setRemoving(exercise))}
            unitPreference={user?.unitPreference ?? "kg"}
            onGone={() => gone("gone")}
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
        <Button disabled={finishDisabled} onClick={() => setFinishOpen(true)}>
          Finish
        </Button>
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
        <p>{removing ? `${plural(removing.sets.length, "set", "sets")} will be deleted.` : null}</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={finishOpen}
        title="Finish workout?"
        confirmLabel="Finish"
        cancelLabel="Keep logging"
        busy={finish.isPending}
        onConfirm={() => void confirmFinish()}
        onCancel={() => setFinishOpen(false)}
      >
        <p>
          {plural(exercises.length, "exercise", "exercises")} · {plural(totalSets, "set", "sets")}. A finished
          workout can't be edited.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={discardOpen}
        title="Discard this workout?"
        confirmLabel="Discard"
        variant="danger"
        busy={discard.isPending}
        onConfirm={() => void confirmDiscard()}
        onCancel={() => setDiscardOpen(false)}
      >
        <p>
          {totalSets === 0
            ? "Nothing has been logged yet."
            : `All ${plural(totalSets, "logged set", "logged sets")} will be deleted.`}
        </p>
      </ConfirmDialog>
    </Screen>
  );
}
