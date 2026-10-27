import { lineageRootId, type Exercise } from "@sin/core";
import { useEffect, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";

import { NotFound } from "../../screens/NotFound";
import { BackLink } from "../../ui/BackLink";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useCatalog } from "../catalog/useCatalog";
import { ExerciseProgressBody } from "../progress/ExerciseProgressBody";
import { groupByExercise } from "../progress/exercises";
import { useSeries } from "../progress/queries";
import { useExerciseRecords } from "../records/queries";
import { classifyWorkoutError } from "../workouts/errors";
import { DeleteExerciseDialog } from "./DeleteExerciseDialog";
import { ExerciseActions } from "./ExerciseActions";
import { ExerciseDetails } from "./ExerciseDetails";
import styles from "./ExerciseScreen.module.css";
import { EXERCISES_COPY } from "./messages";
import { EXERCISES_PATH, exercisePath, FROM_RECORDS, RECORDS_PATH } from "./paths";
import { useExerciseUsage } from "./usage";
import { classifyExerciseError, exerciseErrorMessage } from "./exerciseErrors";
import type { Resolution } from "./resolveExercise";
import { useDeleteExercise } from "./useExerciseMutations";
import { useExercisePage } from "./useExercisePage";

/** Keys the page by id, so moving between exercises starts from the default range and metric (AC20). */
export function ExerciseRoute() {
  const { id = "" } = useParams();
  return <ExerciseScreen key={id} exerciseId={id} />;
}

/**
 * One exercise's page (Spec 18.2 §6.3): its details, then today's Progress body, or the never-logged line;
 * a deleted exercise keeps its history. The 08.1 gone rule (a series 404 / 422 with no data) wins over
 * whatever the catalog says.
 */
export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const resolved = useExercisePage(exerciseId);
  // AC50: a confirmed delete drops the row from the store before the navigation away; until then the page keeps
  // drawing the exercise it is deleting, so the deleted variant never flashes.
  const [deletingRow, setDeletingRow] = useState<Exercise | null>(null);
  const resolution: Resolution = deletingRow && resolved.kind === "deleted" ? { kind: "found", row: deletingRow } : resolved;
  const usage = useExerciseUsage();
  const { refresh } = useCatalog();
  const location = useLocation();
  const neverLogged =
    resolution.kind === "found" && usage.data !== undefined && !usage.data.has(lineageRootId(resolution.row));
  const showBody = resolution.kind === "deleted" || (resolution.kind === "found" && !neverLogged);
  const records = useExerciseRecords(exerciseId, { enabled: showBody });
  const series = useSeries(exerciseId, "3m", { enabled: showBody });
  // Phase B: one polite status line (Saved., copy ready, a failure that closed a sheet), empty at first paint.
  const [status, setStatus] = useState("");
  const titleRef = useRef<HTMLHeadingElement | null>(null);
  const navigate = useNavigate();
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const deleteRef = useRef<HTMLButtonElement>(null);
  const del = useDeleteExercise();

  // Owned here, not by the dialog: the handler must outlive the `found` branch it was started from.
  const confirmDelete = async (row: Exercise, routineCount: number) => {
    setDeletingRow(row);
    try {
      await del.mutateAsync({ id: row.id, routineCount });
      void navigate(EXERCISES_PATH, { replace: true, state: { notice: "deleted", name: row.name } });
    } catch (error) {
      const kind = classifyExerciseError(error);
      setDeletingRow(null);
      setDeleteOpen(false);
      setDeleteError(exerciseErrorMessage(kind, "delete"));
      // A stale row that is really a built-in: the refresh corrects it (deferred minor 127).
      if (kind === "built-in") void refresh(true);
    }
  };

  // AC43: the copy lands here with `{ notice: "copied" }`. Read it from the location (not a state initializer:
  // the page may already be mounted by the built-in's own redirect), then clear it so a reload doesn't repeat it.
  const routerState = location.state as { from?: unknown; notice?: unknown } | null;
  useEffect(() => {
    if (routerState?.notice !== "copied") return;
    setStatus(EXERCISES_COPY.copyReady);
    void navigate(location.pathname, { replace: true, state: routerState.from === "records" ? FROM_RECORDS : null });
    titleRef.current?.focus();
  }, [routerState, location.pathname, navigate]);
  const statusLine = (
    // `role="status"` is polite by itself; no explicit `aria-live`, so it isn't mistaken for the chart's readout.
    <p className={styles.status} role="status" data-testid="exercise-status">
      {status}
    </p>
  );

  const gone = series.data === undefined && series.error ? classifyWorkoutError(series.error).kind : null;
  if (gone === "not-found" || gone === "validation") return <NotFound />;

  // The state goes along, so a Records row that lands on a copy still offers "Back to Records".
  if (resolution.kind === "redirect") return <Navigate replace to={exercisePath(resolution.to)} state={location.state} />;

  const fromRecords = (location.state as { from?: unknown } | null)?.from === "records";
  const back = fromRecords ? (
    <BackLink to={RECORDS_PATH} label={EXERCISES_COPY.backToRecords} />
  ) : (
    <BackLink to={EXERCISES_PATH} label={EXERCISES_COPY.backToExercises} />
  );

  // Loading and error keep the page's heading and Back (deferred minor 120). An id the store doesn't know also
  // waits for its series and records: a made-up one is Not found, and a deleted one's title is its records name,
  // so neither the deleted line nor "Removed exercise" shows first (deferred minors 117, 118).
  const waiting = resolution.kind === "loading" || (resolution.kind === "deleted" && (series.isPending || records.isPending));
  if (waiting) {
    return (
      <Screen title={EXERCISES_COPY.exerciseTitle} lead={back}>
        <Spinner label={EXERCISES_COPY.loadingExercise} />
      </Screen>
    );
  }
  if (resolution.kind === "error") {
    return (
      <Screen title={EXERCISES_COPY.exerciseTitle} lead={back}>
        <InlineNotice tone="error" actionLabel={EXERCISES_COPY.retry} onAction={() => void refresh(true)}>
          {EXERCISES_COPY.loadExercisesFailed}
        </InlineNotice>
      </Screen>
    );
  }

  if (resolution.kind === "deleted") {
    const title = (records.data ? groupByExercise(records.data)[0]?.name : undefined) ?? EXERCISES_COPY.removedExercise;
    return (
      <Screen title={title} lead={back}>
        <p className={styles.line}>{EXERCISES_COPY.deleted}</p>
        {statusLine}
        <ExerciseProgressBody exerciseId={exerciseId} />
      </Screen>
    );
  }

  return (
    <Screen title={resolution.row.name} lead={back} titleRef={titleRef}>
      <ExerciseDetails row={resolution.row} />
      <ExerciseActions
        row={resolution.row}
        onStatus={setStatus}
        deleteRef={deleteRef}
        onDelete={() => {
          setDeleteError(null);
          setDeleteOpen(true);
        }}
      />
      {deleteError !== null ? <InlineNotice tone="error">{deleteError}</InlineNotice> : null}
      {statusLine}
      {neverLogged ? <p className={styles.line}>{EXERCISES_COPY.neverLogged}</p> : <ExerciseProgressBody exerciseId={exerciseId} />}
      {/* Mounted only while open: its routines read then unsubscribes on close, so `gcTime: 0` drops the answer and a
          reopening can never show (or enable Delete on) the last one (AC46, D12). */}
      {resolution.row.ownerUserId !== null && deleteOpen ? (
        <DeleteExerciseDialog
          open={deleteOpen}
          row={resolution.row}
          busy={deletingRow !== null}
          onCancel={() => {
            // Escape mid-delete would hide a delete that still completes (deferred minor 125); Cancel is disabled too.
            if (deletingRow !== null) return;
            setDeleteOpen(false);
            // The native dialog restores focus to the opener; this does the same where it doesn't (AC54).
            deleteRef.current?.focus();
          }}
          onConfirm={(routineCount) => void confirmDelete(resolution.row, routineCount)}
        />
      ) : null}
    </Screen>
  );
}
