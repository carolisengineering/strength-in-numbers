import { Fragment, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import { ROUTINE_SECTIONS_MAX, canLinkRule, type Exercise, type SessionOp, type SessionPatch, type SessionSlot, type WorkoutDetail, type WorkoutExerciseDetail } from "@sin/core";

import { track } from "../../../observability/track";
import { NotFound } from "../../../screens/NotFound";
import { ActionBar, ActionBarHint } from "../../../ui/ActionBar";
import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Screen } from "../../../ui/Screen";
import { Spinner } from "../../../ui/Spinner";
import { VisuallyHidden } from "../../../ui/VisuallyHidden";
import { ExercisePicker } from "../../catalog/ExercisePicker";
import { useCatalog } from "../../catalog/useCatalog";
import { useMe } from "../../me/useMe";
import { LinkToggle } from "../../routines/LinkToggle";
import { SupersetBracket } from "../../routines/SupersetBracket";
import { classifyWorkoutError, isWorkoutGone } from "../errors";
import { ExerciseCard, SEGMENT_FIRST_REASON, SEGMENT_LAST_REASON } from "../ExerciseCard";
import { formatMinutes, workoutMinutes } from "../finishStats";
import { SECTION_HOME, type SummarySection } from "../FinishedWorkoutScreen";
import { formatLocalDate, formatStartedAt } from "../format";
import { WORKOUT_KEYS, useEditWorkoutClient, useEditableWorkout } from "../queries";
import { reportUnexpected } from "../reportUnexpected";
import { ScreenModeContext, type EditOutcome, type EditScreenMode } from "../screenMode";
import { sectionSegments } from "../sectionSegments";
import { SessionSection } from "../SessionSectionHeading";
import { NewExercisesLine } from "../sections/NewExercisesLine";
import { SECTION_COPY } from "../sections/sectionCopy";
import { SectionDialogs } from "../sections/SectionDialogs";
import { useSectionActions } from "../sections/useSectionActions";
import { supersetRows, type SupersetRow } from "../supersetRows";
import type { SectionSegment } from "../sectionSegments";
import { useRegroup } from "../useRegroup";
import { useDeleteWorkout } from "../useWorkoutMutations";
import { WorkoutText } from "../WorkoutText";
import { ChangeTimeSheet } from "../changeTime/ChangeTimeSheet";
import { useChangeTime } from "../changeTime/useChangeTime";
import { DetailsSheet } from "./DetailsSheet";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure, type EditOperation } from "./editFailure";
import { LastSetDialog } from "./LastSetDialog";
import styles from "./EditWorkoutScreen.module.css";
import { editSucceeded, useEditAddExercise, useEditRemoveExercise, useIsEditWritePending } from "./useEditMutations";
import { useEditSectionMutations } from "./useEditSectionMutations";
import { useRevealMoved } from "../useRevealMoved";

type StructureOp = Extract<EditOperation, "add-exercise" | "move-exercise" | "regroup" | "remove-exercise">;

const NO_FLAGS: ReadonlySet<string> = new Set();
const SECTION_LIMIT_ID = "edit-section-limit";

/** The screen's one banner: a warning (a missing set or exercise) or a failure with an optional Try again. */
interface Banner {
  readonly text: string;
  readonly tone: "warning" | "error";
  readonly requestId?: string | null;
  readonly retry?: () => void;
}
const noop = () => {};

type RegroupRequest = { type: "move"; id: string; direction: "up" | "down" } | { type: "toggleLink"; upperId: string };
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Spec 18.0 Phase A: a finished workout's edit screen. A sibling of `ActiveSession`, never a mode of it (D3): it
 * composes the logging screen's leaf components inside `ScreenModeContext` `edit`, and none of the live machinery
 * (outbox, drafts, rest timer, the log bar, Finish). Every write is pessimistic and online-only (D5).
 */
export function EditWorkoutScreen({ section }: { section: SummarySection }) {
  const home = SECTION_HOME[section];
  const { id = "" } = useParams();
  // #160: set while Delete workout is in flight. The detail stops reading (a focus refetch would find it, or 404 once
  // the delete has removed it from the cache), and once it is gone the screen draws nothing until the navigation lands.
  const [leaving, setLeaving] = useState(false);
  const detail = useEditableWorkout(id, { enabled: !leaving });
  const [vanished, setVanished] = useState(false);

  useEffect(() => {
    track("workout_edit_opened", { section });
  }, [section]);

  useEffect(() => {
    if (detail.error) reportUnexpected("load-workout", detail.error);
  }, [detail.error]);

  // Once the workout is gone it stays gone: no write is attempted afterwards (AC20).
  const onVanished = useCallback(() => setVanished(true), []);

  if (leaving && detail.data === undefined) return null;
  if (detail.isPending) return <Spinner label="Loading your workout…" />;

  const failure = detail.isError ? classifyWorkoutError(detail.error, { op: "load-workout" }) : null;

  const gone = detail.isError && isWorkoutGone(detail.error);
  if (vanished || (gone && detail.data !== undefined)) {
    return (
      <Screen title="Edit workout">
        <p className={styles.vanished}>{EDIT_COPY.vanished}</p>
        <BackLink to={home.to} label={home.label} />
      </Screen>
    );
  }

  if (detail.data === undefined) {
    if (gone) return <NotFound />;
    return (
      <Screen title="Edit workout" lead={<BackLink to={home.to} label={home.label} />}>
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void detail.refetch()}>
          {EDIT_COPY.loadFailed}
        </InlineNotice>
      </Screen>
    );
  }

  // An in-progress workout belongs on the session screen.
  if (detail.data.endedAt === null) return <Navigate to="/app/workouts" replace />;

  return (
    <EditBody
      workout={detail.data}
      endedAt={detail.data.endedAt}
      section={section}
      refreshFailed={failure !== null}
      onVanished={onVanished}
      onLeaving={setLeaving}
    />
  );
}

function EditBody({
  workout,
  endedAt,
  section,
  refreshFailed,
  onVanished,
  onLeaving,
}: {
  workout: WorkoutDetail;
  endedAt: string;
  section: SummarySection;
  refreshFailed: boolean;
  onVanished: () => void;
  /** #160: true while Delete workout is in flight (cleared again if it fails). */
  onLeaving: (leaving: boolean) => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const writing = useIsEditWritePending();
  // Each announcement gets a fresh node (the count is its key), so the same text twice is spoken twice (AC44).
  const [announcement, setAnnouncementState] = useState({ text: "", count: 0 });
  const setAnnouncement = useCallback((text: string) => setAnnouncementState((a) => ({ text, count: a.count + 1 })), []);
  const [banner, setBanner] = useState<Banner | null>(null);
  const [lastSetOpen, setLastSetOpen] = useState(false);
  const deleteWorkout = useDeleteWorkout();
  const deleteLock = useRef(false);
  const workoutId = workout.id;
  const home = SECTION_HOME[section].to;
  const setCount = workout.exercises.reduce((n, e) => n + e.sets.length, 0);

  const report = useCallback(
    (outcome: EditOutcome) => {
      switch (outcome.type) {
        case "saved":
          setBanner(null);
          setAnnouncement(outcome.announcement);
          return;
        case "missing":
          // Re-read: a 404 here turns the screen into the vanished view (the parent's refetch-404 path).
          setBanner({ text: outcome.text, tone: "warning" });
          void queryClient.refetchQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });
          return;
        case "vanished":
          onVanished();
          return;
        case "last-set":
          setLastSetOpen(true);
          return;
      }
    },
    [onVanished, queryClient, setAnnouncement, workoutId],
  );

  function keepIt() {
    setLastSetOpen(false);
    track("workout_edit_refused", { reason: "would_be_empty", choice: "kept" });
  }

  /** AC19: the dialog's confirm, and the failure banner's Try again. A 404 is done (`useDeleteWorkout`). */
  async function deleteWholeWorkout(fromDialog: boolean) {
    if (deleteLock.current) return;
    deleteLock.current = true;
    if (fromDialog) track("workout_edit_refused", { reason: "would_be_empty", choice: "deleted" });
    setBanner(null);
    onLeaving(true);
    try {
      await deleteWorkout.mutateAsync({ id: workoutId, phase: "finished", setCount });
      setLastSetOpen(false);
      void navigate(home, { replace: true });
    } catch (error) {
      onLeaving(false);
      setLastSetOpen(false);
      reportUnexpected("discard", error);
      const failure = resolveEditFailure("delete-workout", error);
      setBanner({
        text: failure.type === "message" ? failure.text : EDIT_COPY.deleteFailed,
        tone: "error",
        requestId: failure.type === "message" ? failure.requestId : null,
        retry: () => void deleteWholeWorkout(false),
      });
    } finally {
      deleteLock.current = false;
    }
  }
  const { data: me } = useMe();
  const unitPreference = me?.unitPreference ?? "kg";
  const segments = useMemo(() => sectionSegments(supersetRows(workout.exercises), workout.sections), [workout.exercises, workout.sections]);
  const mode = useMemo<EditScreenMode>(() => ({ kind: "edit", workoutId, report }), [workoutId, report]);

  // ---- exercise structure (AC9–AC11): the live screen's orchestration on the edit hooks (the accepted duplication of D3)
  const catalog = useCatalog();
  const editClient = useEditWorkoutClient();
  const add = useEditAddExercise();
  const remove = useEditRemoveExercise();
  const onRegrouped = useCallback(
    (op: SessionOp) => editSucceeded(queryClient, op.type === "move" ? "exercise_moved" : "exercise_regrouped"),
    [queryClient],
  );
  const regroup = useRegroup({ refresh: WORKOUT_KEYS.detail(workoutId), client: editClient, onDone: onRegrouped });
  const structureLock = useRef(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState<{ name: string } | null>(null);
  const [removing, setRemoving] = useState<WorkoutExerciseDetail | null>(null);
  const [details, setDetails] = useState<{ session: number; open: boolean } | null>(null);
  const detailsHeadingId = useId();
  // Spec 18.0 AC40: Change Time on the REST client, keyed EDIT_MUTATION_KEY (so Done waits); one sheet per opening.
  const retime = useChangeTime({ where: "edit", client: editClient, cacheKey: WORKOUT_KEYS.detail(workoutId) });
  const [changeTime, setChangeTime] = useState<{ session: number; open: boolean } | null>(null);
  const sectionMutations = useEditSectionMutations(workoutId);
  const structureBusy = add.isPending || remove.isPending || regroup.busy || pending !== null || sectionMutations.pending;

  // A tap plans from the segment last committed to the screen (as on the live screen).
  const plannerRef = useRef(new Map<string, { slots: SessionSlot[]; start: number }>());
  useLayoutEffect(() => {
    const next = new Map<string, { slots: SessionSlot[]; start: number }>();
    for (const segment of segments) {
      const slots = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
      for (const row of segment.rows) next.set(row.exercise.id, { slots, start: segment.start });
    }
    plannerRef.current = next;
  }, [segments]);

  // An added card's heading is scrolled into view once it renders (AC9).
  const headingRefs = useRef(new Map<string, HTMLHeadingElement>());
  const reveal = useRef<string | null>(null);
  const headingRefFor = (id: string) => (node: HTMLHeadingElement | null) => {
    if (node) headingRefs.current.set(id, node);
    else headingRefs.current.delete(id);
  };
  useEffect(() => {
    if (reveal.current === null) return;
    const node = headingRefs.current.get(reveal.current);
    if (node === undefined) return;
    reveal.current = null;
    node.scrollIntoView?.({ block: "nearest" });
  }, [workout.exercises]);
  // Spec 10.6 §6.4: a section move remounts its card under another <section>; once its heading is registered, focus and show it.
  const revealMoved = useRevealMoved(workout, segments, headingRefs, () => queryClient.getQueryData<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId)));

  const refetchDetail = () => queryClient.refetchQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });

  // Spec 10.6 AC17: the shared section controls, on this screen's lock, banner, status line and vanished view.
  const sectionActions = useSectionActions({
    workout,
    mutations: sectionMutations,
    structureLock,
    setBanner,
    announce: setAnnouncement,
    refetch: async () => {
      await refetchDetail();
      // Only a 404 re-read means gone (the parent then shows the vanished view); an offline or 5xx re-read keeps the
      // cached workout, so a section 404 still reads as "That section no longer exists".
      const state = queryClient.getQueryState<WorkoutDetail>(WORKOUT_KEYS.detail(workoutId));
      const gone = state?.status === "error" && isWorkoutGone(state.error);
      return gone ? null : state?.data;
    },
    onGone: onVanished,
    offlineText: EDIT_COPY.offline,
    onMoved: revealMoved,
  });

  /** §5.4's structure rows; the screen's banner is where they show. */
  async function handleFailure(op: StructureOp, error: unknown, retry?: () => void, options: { refetched?: boolean } = {}) {
    reportUnexpected(op, error);
    const failure = resolveEditFailure(op, error);
    switch (failure.type) {
      case "done":
        return;
      case "last-set":
        setLastSetOpen(true);
        return;
      case "refetch":
        if (!options.refetched) await refetchDetail();
        return;
      case "unavailable":
        // "Workout gone" and "exercise not visible" both answer 404: a re-read tells them apart (a 404 → the vanished view).
        await refetchDetail();
        setBanner({ text: EDIT_COPY.unavailable, tone: "warning" });
        void catalog.refresh(true);
        return;
      case "retired":
        setBanner({ text: EDIT_COPY.retired, tone: "warning" });
        void catalog.refresh(true);
        return;
      case "unconfirmed":
        await refetchDetail();
        setBanner({ text: failure.text, tone: "warning", requestId: failure.requestId });
        return;
      case "missing":
        setBanner({ text: failure.text, tone: "warning" });
        await refetchDetail();
        return;
      case "vanished":
        onVanished();
        return;
      case "fields":
        setBanner({ text: failure.fallback, tone: "error", requestId: failure.requestId });
        return;
      case "message":
        setBanner({ text: failure.text, tone: "error", requestId: failure.requestId, ...(failure.retry && retry ? { retry } : {}) });
        return;
    }
  }

  async function addExercise(exercise: Exercise) {
    if (structureLock.current) return;
    structureLock.current = true;
    setBanner(null);
    setPickerOpen(false);
    setPending({ name: exercise.name });
    try {
      const added = await add.mutateAsync({ workoutId, exerciseId: exercise.id });
      reveal.current = added.id;
      setAnnouncement(EDIT_COPY.exerciseAdded(exercise.name));
    } catch (error) {
      await handleFailure("add-exercise", error);
    } finally {
      setPending(null);
      structureLock.current = false;
    }
  }

  /** Move / link (AC11): one plan at a time; a failed plain move offers Try again with the same absolute position. */
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
        setBanner({ text: outcome.message, tone: "warning" });
      } else if (outcome.status === "failed") {
        const { retry } = outcome;
        if (retry !== null) await handleFailure("move-exercise", outcome.error, () => void runRegroup(request, retry), { refetched: true });
        else await handleFailure("regroup", outcome.error, undefined, { refetched: true });
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
      await remove.mutateAsync({ workoutId, id: exercise.id });
      setAnnouncement(EDIT_COPY.exerciseRemoved);
    } catch (error) {
      await handleFailure("remove-exercise", error, () => void removeExercise(exercise));
    } finally {
      structureLock.current = false;
    }
  }

  function renderRow(row: SupersetRow, k: number, segment: SectionSegment) {
    const { exercise, bracket, line, label, linkedBelow } = row;
    const below = segment.rows[k + 1]?.exercise;
    const slots: SessionSlot[] = segment.rows.map((r) => ({ id: r.exercise.id, group: r.exercise.supersetGroup }));
    const refusal = canLinkRule(slots, k);
    return (
      <Fragment key={exercise.id}>
        <div className={bracket === "none" ? styles.slot : `${styles.slot} ${styles.grouped}`}>
          <SupersetBracket position={bracket} />
          <ExerciseCard
            exercise={exercise}
            targetLine={line}
            accessibleName={label}
            isFirst={k === 0}
            isLast={k === segment.rows.length - 1}
            structureBusy={structureBusy}
            onMove={(direction) => void runRegroup({ type: "move", id: exercise.id, direction })}
            {...(segment.heading !== null
              ? { moveReasons: { up: k === 0 ? SEGMENT_FIRST_REASON : null, down: k === segment.rows.length - 1 ? SEGMENT_LAST_REASON : null } }
              : {})}
            onRemove={() => (exercise.sets.length === 0 ? void removeExercise(exercise) : setRemoving(exercise))}
            flaggedIds={NO_FLAGS}
            unitPreference={unitPreference}
            onGone={noop}
            headingRef={headingRefFor(exercise.id)}
            sections={workout.sections}
            linked={bracket !== "none"}
            onSection={(sectionId) => void sectionActions.setExerciseSection(exercise, sectionId)}
          />
        </div>
        {below ? (
          <div className={styles.joint}>
            <SupersetBracket position={linkedBelow ? "middle" : "none"} />
            {/* Every neighboring pair: edit mode has no current card. */}
            <LinkToggle
              id={`link-${exercise.id}`}
              above={exercise.exerciseNameSnapshot}
              below={below.exerciseNameSnapshot}
              linked={linkedBelow}
              refusal={refusal.ok ? null : refusal.reason}
              disabled={structureBusy}
              onToggle={() => void runRegroup({ type: "toggleLink", upperId: exercise.id })}
            />
          </div>
        ) : null}
      </Fragment>
    );
  }

  const atSectionCap = workout.sections.length >= ROUTINE_SECTIONS_MAX;

  return (
    <ScreenModeContext.Provider value={mode}>
      <Screen title="Edit workout">
        <p className={styles.banner}>Editing {formatLocalDate(workout.localDate)} workout</p>
        <div className={styles.headerRow}>
          <p className={styles.header}>
            Started {formatStartedAt(workout.startedAt)} · Took {formatMinutes(workoutMinutes(workout.startedAt, endedAt))}
          </p>
          <Button
            variant="secondary"
            disabled={writing || structureBusy}
            onClick={() => setChangeTime((c) => ({ session: (c?.session ?? 0) + 1, open: true }))}
          >
            Change Time
          </Button>
        </div>

        {/* AC52: the workout's own title and notes, shown in full; the edit screen is where an empty value is worth seeing. */}
        <section className={styles.details} aria-labelledby={detailsHeadingId}>
          <h2 className={styles.detailsHeading} id={detailsHeadingId}>
            {EDIT_COPY.details.heading}
          </h2>
          {workout.title === null ? <p className={styles.empty}>{EDIT_COPY.details.noTitle}</p> : <WorkoutText text={workout.title} variant="title" />}
          {workout.notes === null ? <p className={styles.empty}>{EDIT_COPY.details.noNotes}</p> : <WorkoutText text={workout.notes} variant="notes" />}
          <div>
            <Button variant="secondary" onClick={() => setDetails((d) => ({ session: (d?.session ?? 0) + 1, open: true }))}>
              {EDIT_COPY.details.edit}
            </Button>
          </div>
        </section>

        {refreshFailed ? <InlineNotice tone="warning">{EDIT_COPY.refreshFailed}</InlineNotice> : null}
        {banner ? (
          <InlineNotice
            tone={banner.tone}
            requestId={banner.requestId ?? null}
            {...(banner.retry ? { actionLabel: "Try again", onAction: banner.retry } : { onDismiss: () => setBanner(null) })}
          >
            {banner.text}
          </InlineNotice>
        ) : null}

        <div className={styles.cards} aria-busy={regroup.busy || undefined}>
          {workout.exercises.length === 0 && pending === null ? <p className={styles.hint}>{EDIT_COPY.firstExercise}</p> : null}
          {segments.map((segment) => {
            const body = segment.rows.map((row, k) => renderRow(row, k, segment));
            return segment.heading === null ? (
              <Fragment key={segment.key}>{body}</Fragment>
            ) : (
              <SessionSection
                key={segment.key}
                heading={segment.heading}
                notes={segment.notes}
                emptyText={SECTION_COPY.empty}
                empty={segment.rows.length === 0}
                {...(segment.editable && segment.sectionId !== null
                  ? { onEdit: () => sectionActions.openEdit(segment.sectionId!), editRef: sectionActions.editRefFor(segment.sectionId) }
                  : {})}
              >
                {body}
              </SessionSection>
            );
          })}
          {pending ? (
            <div className={styles.placeholder} aria-busy="true">
              <p>Adding {pending.name}…</p>
            </div>
          ) : null}
          {/* Spec 10.6 AC4: the line above the list end; Add section beside Add exercise (AC3; this screen has no bar Add exercise). */}
          <NewExercisesLine sections={workout.sections} />
          <div className={styles.listEnd}>
            <Button variant="secondary" disabled={structureBusy} onClick={() => setPickerOpen(true)}>
              Add exercise
            </Button>
            <Button
              variant="secondary"
              ref={sectionActions.addSectionRef}
              disabled={structureBusy || atSectionCap}
              {...(atSectionCap ? { "aria-describedby": SECTION_LIMIT_ID } : {})}
              onClick={sectionActions.openAdd}
            >
              {SECTION_COPY.addSection}
            </Button>
          </div>
          {atSectionCap ? (
            <p id={SECTION_LIMIT_ID} className={styles.limit}>
              {SECTION_COPY.limit}
            </p>
          ) : null}
        </div>

        <p role="status" data-testid="edit-announcement">
          <VisuallyHidden key={announcement.count}>{announcement.text}</VisuallyHidden>
        </p>

        {details ? (
          <DetailsSheet key={details.session} open={details.open} workout={workout} onClose={() => setDetails((d) => d && { ...d, open: false })} mode={mode} />
        ) : null}
        {changeTime ? (
          <ChangeTimeSheet
            key={changeTime.session}
            open={changeTime.open}
            workout={workout}
            mutation={retime}
            onClose={() => setChangeTime((c) => c && { ...c, open: false })}
            onSaved={() => report({ type: "saved", announcement: EDIT_COPY.timeChanged })}
            onVanished={() => report({ type: "vanished" })}
          />
        ) : null}
        <ExercisePicker open={pickerOpen} onPick={(exercise) => void addExercise(exercise)} onClose={() => setPickerOpen(false)} />
        <ConfirmDialog
          open={removing !== null}
          title={removing ? `Remove ${removing.exerciseNameSnapshot}?` : "Remove exercise?"}
          confirmLabel="Remove"
          variant="danger"
          busy={remove.isPending}
          onConfirm={() => removing && void removeExercise(removing)}
          onCancel={() => setRemoving(null)}
        >
          <p>{removing ? `${plural(removing.sets.length, "set", "sets")} will be deleted.` : null}</p>
        </ConfirmDialog>
        <SectionDialogs actions={sectionActions} sections={workout.sections} />
        <LastSetDialog open={lastSetOpen} busy={deleteWorkout.isPending} onKeep={keepIt} onDelete={() => void deleteWholeWorkout(true)} />

        <ActionBar data-testid="edit-bar">
          <Button disabled={writing || structureBusy} onClick={() => void navigate(`/app/${section}/${workoutId}`, { replace: true })}>
            Done
          </Button>
          {writing || structureBusy ? <ActionBarHint>{EDIT_COPY.saving}</ActionBarHint> : null}
        </ActionBar>
      </Screen>
    </ScreenModeContext.Provider>
  );
}
