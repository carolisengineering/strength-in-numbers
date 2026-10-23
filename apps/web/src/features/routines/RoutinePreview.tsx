import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQueryClient } from "@tanstack/react-query";
import type { Routine, RoutineItem } from "@sin/core";
import { ApiError } from "../../api";
import { BackLink } from "../../ui/BackLink";
import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { useActiveWorkout } from "../workouts/queries";
import { START_CLOCK_MESSAGE, START_FAILED_MESSAGE, useBeginWorkout } from "../workouts/useBeginWorkout";
import type { WorkoutsLocationState } from "../workouts/WorkoutsScreen";
import { useExerciseLookup } from "./exerciseLookup";
import { ItemLine } from "./ItemLine";
import {
  ACTIVE_BLOCKS_START,
  DELETE_FAILED,
  KEEP_AS_ROUTINE,
  KEEP_FAILED,
  KEPT_STATUS,
  LOAD_ONE_FAILED,
  OFFLINE_DELETE,
  OFFLINE_KEEP,
  RATE_LIMITED,
  ROUTINE_GONE,
  START_RETIRED,
} from "./messages";
import { OneOffTag } from "./OneOffTag";
import { isOneOff, oneOffNote } from "./oneOff";
import { EDITOR_FROM_BACK, routineEditPath, WORKOUTS_PATH } from "./paths";
import { ROUTINE_KEYS, useRoutine } from "./queries";
import { reportRoutineUnexpected } from "./reportRoutine";
import { runPosition } from "./routineDraft";
import { routineGroups } from "./routineSections";
import { classifyRoutineError, type ClassifiedRoutineError } from "./routineErrors";
import styles from "./RoutinePreview.module.css";
import { itemAccessibleName, targetLine } from "./targetFormat";
import { useDeleteRoutine, useKeepRoutine } from "./useRoutineMutations";

/** `/app/workouts/routines/:id` — keyed by id, so moving between routines mounts a fresh preview (one start key each). */
export function RoutinePreviewRoute() {
  const { id = "" } = useParams();
  return <RoutinePreview key={id} id={id} />;
}

function RoutinePreview({ id }: { id: string }) {
  const remove = useDeleteRoutine();
  const keep = useKeepRoutine();
  // Spec 10.5 AC8: a Keep answered 404 means a finish removed the routine — show it gone.
  const keepGone = keep.error instanceof ApiError && keep.error.status === 404;
  // While deleting / deleted the id is about to vanish: never fall back to a detail read for it (§6.4).
  const lookup = useRoutine(id, { suspend: remove.isPending || remove.isSuccess || keepGone });
  const error = lookup.status === "error" ? lookup.error : null;

  useEffect(() => {
    if (error) reportRoutineUnexpected("load-routine", error);
  }, [error]);

  if (keepGone) return <RoutineGone />;
  if (lookup.status === "pending") {
    return (
      <Screen title="Routine" lead={<BackToWorkouts />}>
        <p role="status" className={styles.status}>
          Loading routine…
        </p>
      </Screen>
    );
  }
  if (lookup.status === "not-found") return <RoutineGone />;
  if (lookup.status === "error") {
    return (
      <Screen title="Routine" lead={<BackToWorkouts />}>
        <InlineNotice tone="error" requestId={classifyRoutineError(lookup.error).requestId} actionLabel="Retry" onAction={lookup.retry}>
          {LOAD_ONE_FAILED}
        </InlineNotice>
      </Screen>
    );
  }
  return <PreviewBody routine={lookup.routine} remove={remove} keep={keep} />;
}

export function RoutineGone() {
  return (
    <Screen title="Routine" lead={<BackToWorkouts />}>
      <p className={styles.status}>{ROUTINE_GONE}</p>
    </Screen>
  );
}

/** Leads every preview and editor load state, above the `<h1>` (#98): reachable without scrolling past the exercises. */
export function BackToWorkouts() {
  return <BackLink to={WORKOUTS_PATH} label="Back to Workouts" />;
}

export function RoutineItems({ routine }: { routine: Routine }) {
  const lookupExercise = useExerciseLookup();
  const blocks = routineGroups(routine);
  const ordered = blocks.flatMap((b) => b.items);
  const groups = ordered.map((i) => i.supersetGroup);
  let offset = 0;
  const placed = blocks.map((b) => {
    const start = offset;
    offset += b.items.length;
    return { ...b, start };
  });
  const list = (items: readonly RoutineItem[], start: number, label: string) => (
    <ul className={styles.items} aria-label={label}>
      {items.map((item, k) => {
        const exercise = lookupExercise(item.exerciseId);
        const position = runPosition(groups, start + k);
        const group = position === "none" ? null : item.supersetGroup;
        const line = targetLine(item, item.sets);
        const unavailable = exercise.state === "retired" || exercise.state === "missing";
        return (
          <li key={item.id} className={styles.item} aria-label={itemAccessibleName(exercise.name, group, line, unavailable)}>
            <ItemLine name={exercise.name} line={line} notes={item.notes} position={position} unavailable={unavailable} />
          </li>
        );
      })}
    </ul>
  );
  return (
    <>
      {placed.map((block) =>
        block.section === null ? (
          <Fragment key="loose">{list(block.items, block.start, "Exercises")}</Fragment>
        ) : (
          <section key={block.section.id} className={styles.section} aria-labelledby={`preview-section-${block.section.id}`}>
            <h2 id={`preview-section-${block.section.id}`} className={styles.sectionName}>
              {block.section.name}
            </h2>
            {block.section.notes ? <p className={styles.sectionNotes}>{block.section.notes}</p> : null}
            {block.items.length > 0 ? list(block.items, block.start, `Exercises in ${block.section.name}`) : null}
          </section>
        ),
      )}
    </>
  );
}

function deleteMessage(failure: ClassifiedRoutineError): string {
  if (failure.kind === "network") return OFFLINE_DELETE;
  if (failure.kind === "rate-limited") return RATE_LIMITED;
  return DELETE_FAILED;
}

function keepMessage(failure: ClassifiedRoutineError): string {
  if (failure.kind === "network") return OFFLINE_KEEP;
  if (failure.kind === "rate-limited") return RATE_LIMITED;
  return KEEP_FAILED;
}

function PreviewBody({
  routine,
  remove,
  keep,
}: {
  routine: Routine;
  remove: ReturnType<typeof useDeleteRoutine>;
  keep: ReturnType<typeof useKeepRoutine>;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const active = useActiveWorkout();
  const { begin, busy, failure } = useBeginWorkout({ routineId: routine.id });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleteFailure, setDeleteFailure] = useState<ClassifiedRoutineError | null>(null);
  const forgetOnUnmount = useRef<(() => void) | null>(null);
  useEffect(() => () => forgetOnUnmount.current?.(), []);

  // Spec 10.5 AC6–AC9: the one-off note and Keep as a routine.
  const markedOneOff = isOneOff(routine);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- Spec 10.5 AC4: read once per routine data change
  const now = useMemo(() => Date.now(), [routine]);
  const [kept, setKept] = useState(false);
  const [keepFailure, setKeepFailure] = useState<ClassifiedRoutineError | null>(null);
  const keepLock = useRef(false);
  const editLink = useRef<HTMLAnchorElement>(null);
  const focusEdit = useRef(false);
  // No dependency list on purpose (DM-48): it runs after every render until the Edit link exists and the mark is
  // gone, so the focus lands whichever render brings them; the ref guard makes every other run a no-op.
  useLayoutEffect(() => {
    if (!focusEdit.current || markedOneOff) return;
    focusEdit.current = false;
    // The Keep button it came from has unmounted.
    editLink.current?.focus();
  });

  async function onKeep() {
    if (keepLock.current) return;
    keepLock.current = true;
    setKeepFailure(null);
    try {
      await keep.mutateAsync(routine.id);
      focusEdit.current = true;
      setKept(true);
    } catch (caught) {
      reportRoutineUnexpected("keep-routine", caught);
      const classified = classifyRoutineError(caught);
      // A 404 renders the gone state from the parent.
      if (classified.kind !== "not-found") setKeepFailure(classified);
    } finally {
      keepLock.current = false;
    }
  }

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

  // #98: the actions (and their notices) lead, so Start is reachable without scrolling past the exercises.
  return (
    <Screen title={routine.name} lead={<BackToWorkouts />}>
      {markedOneOff || kept ? (
        <div className={styles.oneOffBlock}>
          {markedOneOff ? (
            <>
              <OneOffTag />
              <p className={styles.oneOffNote}>{oneOffNote(routine, now)}</p>
            </>
          ) : null}
          {/* Present before success, so the confirmation is announced when it fills (AC7). */}
          <p role="status" className={styles.status}>
            {kept ? KEPT_STATUS : ""}
          </p>
        </div>
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
        <Link ref={editLink} className={styles.secondary} to={routineEditPath(routine.id)} state={EDITOR_FROM_BACK}>
          Edit
        </Link>
        {markedOneOff ? (
          <Button variant="secondary" busy={keep.isPending} disabled={remove.isPending} onClick={() => void onKeep()}>
            {KEEP_AS_ROUTINE}
          </Button>
        ) : null}
        <Button variant="danger" disabled={keep.isPending} onClick={() => setConfirmOpen(true)}>
          Delete
        </Button>
      </div>
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
      {keepFailure ? (
        keepFailure.kind === "network" || keepFailure.kind === "rate-limited" ? (
          <InlineNotice tone="error" requestId={null}>
            {keepMessage(keepFailure)}
          </InlineNotice>
        ) : (
          <InlineNotice tone="error" requestId={keepFailure.requestId} actionLabel="Retry" onAction={() => void onKeep()}>
            {keepMessage(keepFailure)}
          </InlineNotice>
        )
      ) : null}
      {routine.notes ? <p className={styles.notes}>{routine.notes}</p> : null}
      <RoutineItems routine={routine} />
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
