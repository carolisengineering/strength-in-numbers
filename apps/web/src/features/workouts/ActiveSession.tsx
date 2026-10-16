import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { canLinkRule, type Exercise, type SessionOp, type SessionPatch, type SessionSlot, type WorkoutDetail, type WorkoutExerciseDetail } from "@sin/core";

import { useSession } from "../../auth/useSession";
import { track } from "../../observability/track";
import { applyFinishedCaches } from "../records/cache";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { ActionBar, ActionBarHint } from "../../ui/ActionBar";
import { Screen } from "../../ui/Screen";
import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { ExercisePicker } from "../catalog/ExercisePicker";
import { LinkToggle } from "../routines/LinkToggle";
import { SupersetBracket } from "../routines/SupersetBracket";
import { useCatalog } from "../catalog/useCatalog";
import { advanceAfterLog } from "./currentExercise";
import { useDraftStores } from "./drafts/DraftStoreContext";
import type { LoggedEvent } from "./EntryRow";
import { CollapsedExercise, ExerciseCard, SEGMENT_FIRST_REASON, SEGMENT_LAST_REASON } from "./ExerciseCard";
import { formatStartedTime } from "./format";
import { LogActionContext, createLogActionStore } from "./logAction";
import { EndEarlyDialog } from "./EndEarlyDialog";
import { LogBarButton, type BarAction } from "./LogBarButton";
import { findIncompleteWorkingSets } from "./incomplete";
import { isNetworkFailure } from "./outbox/classify";
import { useOutbox, useOutboxState } from "./outbox/OutboxContext";
import { unsavedNotes, unsavedSets } from "./outbox/ops";
import { project } from "./outbox/project";
import { SyncStatus } from "./outbox/SyncStatus";
import { WORKOUT_KEYS, useWorkoutClient } from "./queries";
import { reportUnexpected } from "./reportUnexpected";
import { resolveFailure, type Operation } from "./sessionErrors";
import { RoutineNotePanel } from "./RoutineNotePanel";
import { sectionSegments, type SectionSegment } from "./sectionSegments";
import { SessionClock } from "./SessionClock";
import { SessionSection } from "./SessionSectionHeading";
import { collapsedSummary } from "./summaryLine";
import { supersetRows, type SupersetRow } from "./supersetRows";
import { finishTimestamp } from "./timestamps";
import { useCurrentExercise } from "./useCurrentExercise";
import { useRegroup } from "./useRegroup";
import { WorkoutMenu } from "./WorkoutMenu";
import { barMode, unloggedPlanned } from "./unloggedPlanned";
import {
  useAddExercise,
  useDeleteWorkout,
  useFinishWorkout,
  useIsSetWritePending,
  useRemoveExercise,
} from "./useWorkoutMutations";
import styles from "./ActiveSession.module.css";

export interface ActiveSessionProps {
  workout: WorkoutDetail;
  /** A one-line message carried over from another screen (e.g. "…resumed it."). */
  notice?: string | null;
  /** Given when `notice` may be put away; omitted for a notice that tracks live state. */
  onDismissNotice?: () => void;
  /**
   * The workout is gone or finished elsewhere: hand back to the Workouts screen (§5.8 gone path).
   * `refetched` says `/active` was already re-read, so the caller need not read it again.
   */
  onGone: (options?: { refetched?: boolean }) => void;
}

interface Banner {
  tone: "info" | "warning" | "error";
  text: string;
  requestId?: string | null;
  retry?: () => void;
}

const CLOCK_MESSAGE = "Your device clock looks wrong — check the date and time, then try again.";
/** A structure write, finish or discard that failed at the network (Spec 06.2 AC15). */
const OFFLINE_MESSAGE = "You're offline — try again when you have signal";
const EMPTY_IDS: ReadonlySet<string> = new Set();

type RegroupRequest = { type: "move"; id: string; direction: "up" | "down" } | { type: "toggleLink"; upperId: string };

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The in-progress workout (Spec 06.1 §5.3): one current exercise card (Spec 17.1), the others collapsed, a sticky action bar, the exercise picker,
 * Finish and Discard. Exercise-structure writes (add / move / regroup / remove, Spec 10.1) are serialised: each changes
 * sibling `position`s, and the next move's arithmetic comes from the list on screen, so one write plus
 * its refetch at a time (§6.3).
 */
export function ActiveSession({ workout, notice, onDismissNotice, onGone }: ActiveSessionProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const client = useWorkoutClient();
  const { user } = useSession();
  const catalog = useCatalog();
  const add = useAddExercise();
  const regroup = useRegroup();
  const remove = useRemoveExercise();
  const finish = useFinishWorkout();
  const discard = useDeleteWorkout();
  const setWritePending = useIsSetWritePending();
  const drafts = useDraftStores();

  // Spec 06.5 AC10: an entry whose exercise is no longer in the workout is dropped on the next write.
  const exerciseIds = workout.exercises.map((e) => e.id).join(",");
  useEffect(() => {
    drafts?.forWorkout(workout.id).retainOnly(new Set(exerciseIds === "" ? [] : exerciseIds.split(",")));
  }, [drafts, workout.id, exerciseIds]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string } | null>(null);
  const [removing, setRemoving] = useState<WorkoutExerciseDetail | null>(null);
  const [finishOpen, setFinishOpen] = useState(false);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [endEarlyOpen, setEndEarlyOpen] = useState(false);
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
  const rows = useMemo(() => supersetRows(workout.exercises), [workout.exercises]);
  const segments = useMemo(() => sectionSegments(rows, workout.sections), [rows, workout.sections]);
  // Spec 17.1 §6.2: one exercise is current; the hook holds only the lifter's choice.
  const current = useCurrentExercise(rows);
  const { select: selectCurrent } = current;
  const unitPreference = user?.unitPreference ?? "kg";
  const headingRefs = useRef(new Map<string, HTMLHeadingElement>());
  // §6.8: a tap focuses the new card's heading; any change scrolls it into view after commit.
  const reveal = useRef<{ id: string; focus: boolean } | null>(null);
  const makeCurrent = useCallback(
    (id: string, focus: boolean) => {
      reveal.current = { id, focus };
      selectCurrent(id);
    },
    [selectCurrent],
  );
  useEffect(() => {
    const pending = reveal.current;
    if (pending === null || pending.id !== current.currentId) return;
    const node = headingRefs.current.get(pending.id);
    if (node === undefined) return;
    reveal.current = null;
    if (pending.focus) node.focus();
    node.scrollIntoView?.({ block: "nearest" });
  }, [current.currentId]);

  const [logStore] = useState(createLogActionStore);
  const [announcement, setAnnouncement] = useState("");
  const currentIdRef = useRef<string | null>(current.currentId);
  useLayoutEffect(() => {
    currentIdRef.current = current.currentId;
  });

  /**
   * Spec 17.1 AC14–AC15: after a log, move current per `advanceAfterLog`, read from the cache the log just wrote
   * (this render's `rows` may not hold the new set yet). Never when the lifter typed since the tap, and never when
   * they already moved to another exercise (a late response).
   */
  function onLogged({ exerciseId, set, advance, wasExtra }: LoggedEvent) {
    if (!advance || currentIdRef.current !== exerciseId) return;
    const fresh = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
    if (!fresh || fresh.id !== workout.id) return;
    const freshRows = supersetRows(fresh.exercises);
    const next = advanceAfterLog({ rows: freshRows, loggedId: exerciseId, wasExtra });
    if (next === exerciseId) return;
    reveal.current = { id: next, focus: false };
    current.advanceFrom(exerciseId, next);
    // The panel that announced "Set N logged" unmounts with the advance, so the screen says it.
    const nextName = freshRows.find((r) => r.exercise.id === next)?.exercise.exerciseNameSnapshot ?? "";
    setAnnouncement(`Set ${set.setNumber} logged. Next: ${nextName}`);
  }
  const headingRefFor = (id: string) => (node: HTMLHeadingElement | null) => {
    if (node) headingRefs.current.set(id, node);
    else headingRefs.current.delete(id);
  };
  // A tap plans from the segment last committed to the screen (set after commit, never during render).
  const plannerRef = useRef(new Map<string, { slots: SessionSlot[]; start: number }>());
  useLayoutEffect(() => {
    const next = new Map<string, { slots: SessionSlot[]; start: number }>();
    for (const segment of segments) {
      const slots = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
      for (const row of segment.rows) next.set(row.exercise.id, { slots, start: segment.start });
    }
    plannerRef.current = next;
  }, [segments]);
  const totalSets = exercises.reduce((n, e) => n + e.sets.length, 0);
  const structureBusy = add.isPending || regroup.busy || remove.isPending || pending !== null;

  // A flag lasts only while the set is still incomplete: fixing or deleting it clears the marker.
  const flagged = useMemo(() => {
    if (flaggedIds.size === 0) return EMPTY_IDS;
    return new Set(findIncompleteWorkingSets(workout).filter((id) => flaggedIds.has(id)));
  }, [flaggedIds, workout]);

  // The first flagged row in display order (exercise position, then set order) gets the ref.
  const firstFlaggedId = useMemo(() => {
    for (const exercise of exercises) {
      const set = exercise.sets.find((s) => flagged.has(s.id));
      if (set) return set.id;
    }
    return null;
  }, [exercises, flagged]);
  const firstFlaggedRef = useRef<HTMLButtonElement | null>(null);
  const setFirstFlaggedRef = useCallback((node: HTMLButtonElement | null) => {
    firstFlaggedRef.current = node;
  }, []);

  // ---- outbox (Spec 06.2) ------------------------------------------------------------------------
  const outbox = useOutbox();
  const outboxState = useOutboxState();
  // The cached workout is already projected; projecting it again only yields the per-row sync map.
  const { sync } = useMemo(() => project(workout, outboxState), [workout, outboxState]);
  // Counted in sets, not queued writes: a set with an appended edit is still one set.
  const { pending: pendingCount, failed: failedCount } = unsavedSets(outboxState.ops, workout.id, outboxState.idMap);
  const { pending: notePending, failed: noteFailed } = unsavedNotes(outboxState.ops, workout.id);
  const unsavedNoteCount = notePending + noteFailed;
  const firstFailedId = useMemo(() => {
    for (const exercise of exercises) {
      if (sync.get(exercise.id)?.state === "failed") return exercise.id; // a failed note sits above its exercise's sets
      const set = exercise.sets.find((s) => sync.get(s.id)?.state === "failed");
      if (set) return set.id;
    }
    return null;
  }, [exercises, sync]);
  const failedRowRef = useRef<HTMLElement | null>(null);
  const setFailedRowRef = useCallback((node: HTMLElement | null) => {
    failedRowRef.current = node;
  }, []);

  // Bring the first offending row into view when Finish is blocked (phones: the row may be offscreen).
  // Once per diagnosis: the flagged set may only render a beat later, when the re-read reaches this
  // screen's `workout` prop, so wait for its row; fixing that row later must not scroll to the next.
  const scrollPending = useRef(false);
  useEffect(() => {
    if (!scrollPending.current || firstFlaggedRef.current === null) return;
    scrollPending.current = false;
    firstFlaggedRef.current.scrollIntoView?.({ block: "center" });
  }, [flaggedIds, firstFlaggedId]);

  const refetchActive = () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.active });

  const gone = (reason: "gone" | "finished", options?: { refetched?: boolean }) => {
    drafts?.clearWorkout(workout.id);
    track("workout_conflict", { kind: reason });
    onGone(options);
  };

  /** Resolve a failed exercise-structure write per §5.8. */
  async function handleFailure(op: Operation, error: unknown, retry?: () => void, options: { refetched?: boolean } = {}) {
    reportUnexpected(op, error);
    const action = resolveFailure(op, error);
    switch (action.type) {
      case "gone":
        gone(action.reason);
        return;
      case "refetch":
        track("workout_conflict", { kind: "stale-position" });
        if (!options.refetched) await refetchActive();
        return;
      case "unavailable": {
        // The API answers 404 both for "workout gone" and "exercise not visible": refetch to tell.
        await refetchActive();
        const current = queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active);
        if (!current || current.id !== workout.id) {
          gone("gone", { refetched: true });
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
        const text = isNetworkFailure(error)
          ? OFFLINE_MESSAGE
          : action.type === "retry"
            ? action.text
            : "Something went wrong — try again";
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
      const added = await add.mutateAsync({ workoutId: workout.id, exerciseId: exercise.id, modality: exercise.modality });
      reveal.current = { id: added.id, focus: false };
      current.selectWhenAdded(added.id);
    } catch (error) {
      await handleFailure("add-exercise", error);
    } finally {
      setPending(null);
      structureLock.current = false;
    }
  }

  /**
   * Link / unlink / block move (Spec 10.1 §6.3): one plan at a time, sharing the structure lock with add
   * and remove. `useRegroup` already re-read the workout on failure. A failed plain move (one position
   * PATCH) keeps 06.1's copy and Try again, which re-sends that same absolute position; any other
   * failed plan offers none (D7).
   */
  async function runRegroup(request: RegroupRequest, resend?: SessionPatch) {
    if (structureLock.current) return;
    const anchor = request.type === "move" ? request.id : request.upperId;
    const context = plannerRef.current.get(anchor);
    if (!context) return;
    const op: SessionOp =
      request.type === "move" ? request : { type: "toggleLink", index: context.slots.findIndex((s) => s.id === request.upperId) };
    structureLock.current = true;
    setBanner(null);
    try {
      const outcome = resend ? await regroup.resend(resend, op) : await regroup.run(context.slots, op, { positionOffset: context.start });
      if (outcome.status === "refused") {
        setBanner({ tone: "warning", text: outcome.message });
      } else if (outcome.status === "failed") {
        const { retry } = outcome;
        if (retry !== null) {
          await handleFailure("move-exercise", outcome.error, () => void runRegroup(request, retry), { refetched: true });
        } else {
          await handleFailure("regroup", outcome.error, undefined, { refetched: true });
        }
      }
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
    scrollPending.current = ids.length > 0;
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
  async function confirmAlreadyFinished(endedEarly: boolean) {
    try {
      const fresh = await client.getById(workout.id);
      if (fresh.endedAt === null) {
        gone("gone");
        return;
      }
      // As in `useFinishWorkout`: seed only; the summary screen clears the active entry.
      queryClient.setQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workout.id), fresh);
      // The lost response carried `newRecords`; the summary refetches them by workoutId (Spec 08.0 AC7, D7).
      applyFinishedCaches(queryClient, workout.id, null);
      track("workout_finished", {
        exerciseCount: fresh.exercises.length,
        setCount: fresh.exercises.reduce((n, e) => n + e.sets.length, 0),
        durationMin: Math.round((Date.parse(fresh.endedAt) - Date.parse(fresh.startedAt)) / 60_000),
        viaReplay: true,
        endedEarly,
        unloggedPlannedSets: unlogged.total,
      });
      afterFinished();
    } catch {
      setBanner({ tone: "error", text: "Couldn't finish — try again", retry: () => void confirmFinish(endedEarly) });
    }
  }

  /**
   * After a successful finish: open the summary, which clears the active entry (Spec 06.4 D1). If the
   * lifter already left this screen, the summary never mounts, so clear the entry here instead — else
   * the finished workout would come back as an active session from cache.
   */
  function afterFinished() {
    if (mounted.current) {
      void navigate(`/app/workouts/${workout.id}`);
    } else if (queryClient.getQueryData<WorkoutDetail | null>(WORKOUT_KEYS.active)?.id === workout.id) {
      queryClient.removeQueries({ queryKey: WORKOUT_KEYS.active });
    }
  }

  /** The one finish path (Spec 17.1 §6.7): Finish and End workout early both call it, so their waits and failures match. */
  async function confirmFinish(endedEarly = false) {
    if (finishLock.current) return;
    finishLock.current = true;
    setBanner(null);
    try {
      await finish.mutateAsync({ id: workout.id, endedAt: finishTimestamp(workout.startedAt, new Date()), endedEarly, unloggedPlannedSets: unlogged.total });
      setFinishOpen(false);
      setEndEarlyOpen(false);
      // Navigation stays out of the mutation hook: a response that lands after the lifter left this
      // screen must not yank them back across screens.
      afterFinished();
    } catch (error) {
      setFinishOpen(false);
      setEndEarlyOpen(false);
      reportUnexpected("finish", error);
      const action = resolveFailure("finish", error);
      switch (action.type) {
        case "gone":
          gone(action.reason);
          break;
        case "incomplete":
          await diagnoseIncomplete();
          break;
        case "finished-check":
          await confirmAlreadyFinished(endedEarly);
          break;
        case "clock":
          track("workout_conflict", { kind: "clock" });
          setBanner({ tone: "error", text: CLOCK_MESSAGE, requestId: action.requestId });
          break;
        default:
          setBanner({
            tone: "error",
            text: isNetworkFailure(error)
              ? OFFLINE_MESSAGE
              : action.type === "retry"
                ? action.text
                : "Couldn't finish — try again",
            requestId: "requestId" in action ? action.requestId : null,
            retry: () => void confirmFinish(endedEarly),
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
      reportUnexpected("discard", error);
      const action = resolveFailure("discard", error);
      setBanner({
        tone: "error",
        text: isNetworkFailure(error)
          ? OFFLINE_MESSAGE
          : action.type === "retry"
            ? action.text
            : "Couldn't discard the workout — try again",
        requestId: "requestId" in action ? action.requestId : null,
        retry: () => void confirmDiscard(),
      });
    } finally {
      discardLock.current = false;
    }
  }

  function renderRow(row: SupersetRow, k: number, segment: SectionSegment) {
    const { exercise, bracket, line, label, linkedBelow } = row;
    const below = segment.rows[k + 1]?.exercise;
    const segmentSlots: SessionSlot[] = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
    const refusal = canLinkRule(segmentSlots, k);
    const isCurrent = exercise.id === current.currentId;
    // Spec 17.1 AC16: a link toggle only beside the current card; elsewhere just the bracket's continuity.
    const showToggle = below !== undefined && (isCurrent || below.id === current.currentId);
    return (
      <Fragment key={exercise.id}>
        <div className={bracket === "none" ? styles.slot : `${styles.slot} ${styles.grouped}`}>
          <SupersetBracket position={bracket} />
          {isCurrent ? (
            <ExerciseCard
              exercise={exercise}
              logExtra={mode === "finish"}
              targetLine={line}
              accessibleName={label}
              isFirst={k === 0}
              isLast={k === segment.rows.length - 1}
              structureBusy={structureBusy}
              flaggedIds={flagged}
              firstFlaggedId={firstFlaggedId}
              firstFlaggedRef={setFirstFlaggedRef}
              onMove={(direction) => void runRegroup({ type: "move", id: exercise.id, direction })}
              {...(segment.heading !== null
                ? { moveReasons: { up: k === 0 ? SEGMENT_FIRST_REASON : null, down: k === segment.rows.length - 1 ? SEGMENT_LAST_REASON : null } }
                : {})}
              onRemove={() => (exercise.sets.length === 0 ? void removeExercise(exercise) : setRemoving(exercise))}
              unitPreference={unitPreference}
              onGone={gone}
              sync={sync}
              onDiscardOp={(opId) => outbox?.discard(opId)}
              firstFailedId={firstFailedId}
              failedRowRef={setFailedRowRef}
              headingRef={headingRefFor(exercise.id)}
              onLogged={onLogged}
            />
          ) : (
            <CollapsedExercise
              exercise={exercise}
              summary={collapsedSummary(row, unitPreference)}
              accessibleName={label}
              sync={sync}
              onSelect={() => makeCurrent(exercise.id, true)}
            />
          )}
        </div>
        {below ? (
          <div className={styles.joint}>
            <SupersetBracket position={linkedBelow ? "middle" : "none"} />
            {showToggle ? (
              <LinkToggle
                id={`link-${exercise.id}`}
                above={exercise.exerciseNameSnapshot}
                below={below.exerciseNameSnapshot}
                linked={linkedBelow}
                refusal={refusal.ok ? null : refusal.reason}
                disabled={structureBusy}
                onToggle={() => void runRegroup({ type: "toggleLink", upperId: exercise.id })}
              />
            ) : null}
          </div>
        ) : null}
      </Fragment>
    );
  }

  const shown: Banner | null = banner ?? (notice ? { tone: "info", text: notice } : null);
  const dismiss = banner === null ? onDismissNotice : undefined;
  const unsaved = pendingCount + failedCount;
  // Spec 06.2 AC16: Finish waits for every queued or failed set AND note write of this workout — a PATCH after
  // Finish answers `409 workout-finished` and would be lost (Spec 10.3 AC29).
  const finishDisabled = totalSets === 0 || setWritePending || structureBusy || unsaved > 0 || unsavedNoteCount > 0;
  // Spec 17.1 §6.6: the bar's mode and the planned sets End early would skip.
  const unlogged = useMemo(() => unloggedPlanned(rows), [rows]);
  const mode = barMode(rows, current.currentId);
  const freeForm = unlogged.planned === 0;
  const barAction: BarAction =
    mode === "add"
      ? { kind: "add", disabled: structureBusy, onClick: () => setPickerOpen(true) }
      : mode === "finish"
        ? { kind: "finish", disabled: finishDisabled, onClick: () => setFinishOpen(true) }
        : { kind: "log" };
  const endReason =
    totalSets === 0 ? "Log a set first" : unsaved > 0 ? `${plural(unsaved, "set", "sets")} not saved yet` : unsavedNoteCount > 0 ? `${plural(unsavedNoteCount, "note", "notes")} not saved yet` : null;
  const endItem = {
    label: unlogged.total > 0 ? ("End workout early" as const) : ("Finish workout" as const),
    disabled: finishDisabled,
    reason: endReason,
    onClick: () => (unlogged.total > 0 ? setEndEarlyOpen(true) : setFinishOpen(true)),
  };

  return (
    <LogActionContext.Provider value={logStore}>
    <Screen title="Workout">
      <WorkoutMenu
        leading={
          <>
            <SessionClock startedAt={workout.startedAt} />
            <p className={styles.started}>Started {formatStartedTime(workout.startedAt)}</p>
          </>
        }
        endItem={endItem}
        onDiscard={() => setDiscardOpen(true)}
      />

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
          {...(dismiss ? { onDismiss: dismiss } : {})}
        >
          {shown.text}
        </InlineNotice>
      ) : null}

      {outboxState.conflict ? (
        <InlineNotice tone="warning" actionLabel="Reload" onAction={() => window.location.reload()}>
          This workout is open in another tab. Reload to continue here.
        </InlineNotice>
      ) : null}

      {workout.routineNotes !== null ? <RoutineNotePanel name={workout.routineName} notes={workout.routineNotes} /> : null}

      <div className={styles.cards} aria-busy={regroup.busy || undefined}>
        {exercises.length === 0 && pending === null ? (
          <p className={styles.hint}>Add your first exercise</p>
        ) : null}
        {segments.map((segment) => {
          const body = segment.rows.map((row, k) => renderRow(row, k, segment));
          return segment.heading === null ? (
            <Fragment key={segment.key}>{body}</Fragment>
          ) : (
            <SessionSection key={segment.key} heading={segment.heading} notes={segment.notes}>
              {body}
            </SessionSection>
          );
        })}
        {pending ? (
          <div className={styles.placeholder} aria-busy="true">
            <p>Adding {pending.name}…</p>
          </div>
        ) : null}
        {exercises.length > 0 ? (
          <div className={styles.listEnd}>
            <Button variant="secondary" disabled={structureBusy} onClick={() => setPickerOpen(true)}>
              Add exercise
            </Button>
            {/* D14: a workout with no plan has no Finish mode, so Finish lives here. */}
            {freeForm ? (
              <Button variant="secondary" disabled={finishDisabled} onClick={() => setFinishOpen(true)}>
                Finish workout
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      <p role="status" data-testid="session-announcement">
        <VisuallyHidden>{announcement}</VisuallyHidden>
      </p>
      <SyncStatus
        pending={pendingCount}
        failed={failedCount}
        pendingNotes={notePending}
        failedNotes={noteFailed}
        online={outboxState.online}
        onRetry={() => outbox?.retryNow()}
        onDiscardFailed={() => outbox?.discardFailed(workout.id)}
        onShowFailed={firstFailedId ? () => failedRowRef.current?.scrollIntoView?.({ block: "center" }) : null}
      />

      <ActionBar data-testid="session-bar">
        <LogBarButton action={barAction} />
        {totalSets === 0 ? <ActionBarHint>Log at least one set to finish</ActionBarHint> : null}
        {unsaved > 0 ? <ActionBarHint>{plural(unsaved, "set", "sets")} not saved yet</ActionBarHint> : null}
        {unsavedNoteCount > 0 ? <ActionBarHint>{plural(unsavedNoteCount, "note", "notes")} not saved yet</ActionBarHint> : null}
      </ActionBar>

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
        onConfirm={() => void confirmFinish(false)}
        onCancel={() => setFinishOpen(false)}
      >
        <p>
          {plural(exercises.length, "exercise", "exercises")} · {plural(totalSets, "set", "sets")}. A finished
          workout can't be edited.
        </p>
      </ConfirmDialog>
      <EndEarlyDialog open={endEarlyOpen} unlogged={unlogged} busy={finish.isPending} onConfirm={() => void confirmFinish(true)} onCancel={() => setEndEarlyOpen(false)} />

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
    </LogActionContext.Provider>
  );
}
