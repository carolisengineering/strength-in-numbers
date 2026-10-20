import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router";
import type { WorkoutDetail } from "@sin/core";

import { track } from "../../../observability/track";
import { NotFound } from "../../../screens/NotFound";
import { ActionBar } from "../../../ui/ActionBar";
import { BackLink } from "../../../ui/BackLink";
import { Button } from "../../../ui/Button";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Screen } from "../../../ui/Screen";
import { Spinner } from "../../../ui/Spinner";
import { useMe } from "../../me/useMe";
import { SupersetBracket } from "../../routines/SupersetBracket";
import { classifyWorkoutError } from "../errors";
import { ExerciseCard } from "../ExerciseCard";
import { formatMinutes, workoutMinutes } from "../finishStats";
import { SECTION_HOME, type SummarySection } from "../FinishedWorkoutScreen";
import { formatLocalDate, formatStartedAt } from "../format";
import { useEditableWorkout } from "../queries";
import { reportUnexpected } from "../reportUnexpected";
import { ScreenModeContext, type EditOutcome, type EditScreenMode } from "../screenMode";
import { sectionSegments } from "../sectionSegments";
import { SessionSection } from "../SessionSectionHeading";
import { supersetRows } from "../supersetRows";
import { EDIT_COPY } from "./editCopy";
import styles from "./EditWorkoutScreen.module.css";

const NO_FLAGS: ReadonlySet<string> = new Set();
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

  const report = useCallback((outcome: EditOutcome) => {
    // Once the workout is gone it stays gone: no write is attempted afterwards (AC20).
    if (outcome.type === "vanished") setVanished(true);
  }, []);

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
      report={report}
    />
  );
}

function EditBody({
  workout,
  endedAt,
  section,
  refreshFailed,
  report,
}: {
  workout: WorkoutDetail;
  endedAt: string;
  section: SummarySection;
  refreshFailed: boolean;
  report: (outcome: EditOutcome) => void;
}) {
  const navigate = useNavigate();
  const { data: me } = useMe();
  const unitPreference = me?.unitPreference ?? "kg";
  const segments = useMemo(() => sectionSegments(supersetRows(workout.exercises), workout.sections), [workout.exercises, workout.sections]);
  const mode = useMemo<EditScreenMode>(() => ({ kind: "edit", workoutId: workout.id, report }), [workout.id, report]);

  return (
    <ScreenModeContext.Provider value={mode}>
      <Screen title="Edit workout">
        <p className={styles.banner}>Editing {formatLocalDate(workout.localDate)} workout</p>
        <p className={styles.header}>
          Started {formatStartedAt(workout.startedAt)} · Took {formatMinutes(workoutMinutes(workout.startedAt, endedAt))}
        </p>

        {refreshFailed ? <InlineNotice tone="warning">{EDIT_COPY.refreshFailed}</InlineNotice> : null}

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

        <ActionBar data-testid="edit-bar">
          <Button onClick={() => void navigate(`/app/${section}/${workout.id}`, { replace: true })}>Done</Button>
        </ActionBar>
      </Screen>
    </ScreenModeContext.Provider>
  );
}
