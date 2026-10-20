import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Navigate, useNavigate, useParams } from "react-router";
import type { WorkoutDetail } from "@sin/core";

import { track } from "../../../observability/track";
import { NotFound } from "../../../screens/NotFound";
import { ActionBar, ActionBarHint } from "../../../ui/ActionBar";
import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Screen } from "../../../ui/Screen";
import { Spinner } from "../../../ui/Spinner";
import { VisuallyHidden } from "../../../ui/VisuallyHidden";
import { useMe } from "../../me/useMe";
import { SupersetBracket } from "../../routines/SupersetBracket";
import { classifyWorkoutError } from "../errors";
import { ExerciseCard } from "../ExerciseCard";
import { formatMinutes, workoutMinutes } from "../finishStats";
import { SECTION_HOME, type SummarySection } from "../FinishedWorkoutScreen";
import { formatLocalDate, formatStartedAt } from "../format";
import { WORKOUT_KEYS, useEditableWorkout } from "../queries";
import { reportUnexpected } from "../reportUnexpected";
import { ScreenModeContext, type EditOutcome, type EditScreenMode } from "../screenMode";
import { sectionSegments } from "../sectionSegments";
import { SessionSection } from "../SessionSectionHeading";
import { supersetRows } from "../supersetRows";
import { useDeleteWorkout } from "../useWorkoutMutations";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure } from "./editFailure";
import { LastSetDialog } from "./LastSetDialog";
import styles from "./EditWorkoutScreen.module.css";
import { useIsEditWritePending } from "./useEditMutations";

const NO_FLAGS: ReadonlySet<string> = new Set();

/** The screen's one banner: a warning (a missing set or exercise) or a failure with an optional Try again. */
interface Banner {
  readonly text: string;
  readonly tone: "warning" | "error";
  readonly requestId?: string | null;
  readonly retry?: () => void;
}
const noop = () => {};

/**
 * Spec 18.0 Phase A: a finished workout's edit screen. A sibling of `ActiveSession`, never a mode of it (D3): it
 * composes the logging screen's leaf components inside `ScreenModeContext` `edit`, and none of the live machinery
 * (outbox, drafts, rest timer, the log bar, Finish). Every write is pessimistic and online-only (D5).
 */
export function EditWorkoutScreen({ section }: { section: SummarySection }) {
  const home = SECTION_HOME[section];
  const { id = "" } = useParams();
  const detail = useEditableWorkout(id);
  const [vanished, setVanished] = useState(false);

  useEffect(() => {
    track("workout_edit_opened", { section });
  }, [section]);

  useEffect(() => {
    if (detail.error) reportUnexpected("load-workout", detail.error);
  }, [detail.error]);

  // Once the workout is gone it stays gone: no write is attempted afterwards (AC20).
  const onVanished = useCallback(() => setVanished(true), []);

  if (detail.isPending) return <Spinner label="Loading your workout…" />;

  const failure = detail.isError ? classifyWorkoutError(detail.error, { op: "load-workout" }) : null;

  if (vanished || (failure?.kind === "not-found" && detail.data !== undefined)) {
    return (
      <Screen title="Edit workout">
        <p className={styles.vanished}>{EDIT_COPY.vanished}</p>
        <BackLink to={home.to} label={home.label} />
      </Screen>
    );
  }

  if (detail.data === undefined) {
    if (failure?.kind === "not-found") return <NotFound />;
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
    />
  );
}

function EditBody({
  workout,
  endedAt,
  section,
  refreshFailed,
  onVanished,
}: {
  workout: WorkoutDetail;
  endedAt: string;
  section: SummarySection;
  refreshFailed: boolean;
  onVanished: () => void;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const writing = useIsEditWritePending();
  const [announcement, setAnnouncement] = useState("");
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
    [onVanished, queryClient, workoutId],
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
    try {
      await deleteWorkout.mutateAsync({ id: workoutId, phase: "finished", setCount });
      setLastSetOpen(false);
      void navigate(home, { replace: true });
    } catch (error) {
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

  return (
    <ScreenModeContext.Provider value={mode}>
      <Screen title="Edit workout">
        <p className={styles.banner}>Editing {formatLocalDate(workout.localDate)} workout</p>
        <p className={styles.header}>
          Started {formatStartedAt(workout.startedAt)} · Took {formatMinutes(workoutMinutes(workout.startedAt, endedAt))}
        </p>

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

        <div className={styles.cards}>
          {segments.map((segment) => {
            const body = segment.rows.map((row, k) => (
              <Fragment key={row.exercise.id}>
                <div className={row.bracket === "none" ? styles.slot : `${styles.slot} ${styles.grouped}`}>
                  <SupersetBracket position={row.bracket} />
                  <ExerciseCard
                    exercise={row.exercise}
                    targetLine={row.line}
                    accessibleName={row.label}
                    isFirst={k === 0}
                    isLast={k === segment.rows.length - 1}
                    structureBusy={false}
                    onMove={noop}
                    onRemove={noop}
                    flaggedIds={NO_FLAGS}
                    unitPreference={unitPreference}
                    onGone={noop}
                  />
                </div>
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

        <p role="status" data-testid="edit-announcement">
          <VisuallyHidden>{announcement}</VisuallyHidden>
        </p>

        <LastSetDialog open={lastSetOpen} busy={deleteWorkout.isPending} onKeep={keepIt} onDelete={() => void deleteWholeWorkout(true)} />

        <ActionBar data-testid="edit-bar">
          <Button disabled={writing} onClick={() => void navigate(`/app/${section}/${workoutId}`, { replace: true })}>
            Done
          </Button>
          {writing ? <ActionBarHint>{EDIT_COPY.saving}</ActionBarHint> : null}
        </ActionBar>
      </Screen>
    </ScreenModeContext.Provider>
  );
}
