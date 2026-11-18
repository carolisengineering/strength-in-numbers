import { lineageRootId } from "@sin/core";
import { useEffect } from "react";
import { Link } from "react-router";
import { InlineNotice } from "../../ui/InlineNotice";
import { usePane } from "../../ui/paneContext";
import selection from "../../ui/selectedRow.module.css";
import { Spinner } from "../../ui/Spinner";
import { useCatalog } from "../catalog/useCatalog";
import { useMe } from "../me/useMe";
import { groupByExercise, headlineText } from "../progress/exercises";
import { useAllRecords } from "../records/queries";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { exercisePath, FROM_RECORDS } from "./paths";
import styles from "./RecordsView.module.css";

/**
 * Exercises the lifter holds records for, newest record first (Spec 08.1 §5.2, D6): the Exercises tab's
 * Records view (Spec 18.2 AC6). `ExercisesListScreen` draws the `Screen`; each row opens the exercise page, and beside
 * it (Spec 17.12 AC22) the open one is `aria-current="page"` with the selected look.
 */
export function RecordsView() {
  const query = useAllRecords();
  const { selectedId } = usePane();
  // A Records entry carries the lineage root's id (the API groups a copy's records under its built-in), while the open
  // exercise may be the copy: match either (code review #1). Subscribe only: the store needs no sync for this.
  const { state: catalog } = useCatalog({ refresh: false });
  const selectedRow = selectedId === null ? undefined : catalog.rows.find((row) => row.id === selectedId);
  const selectedRoot = selectedRow ? lineageRootId(selectedRow) : selectedId;
  const { data: me } = useMe();
  const unitPreference = me?.unitPreference ?? "kg";

  useEffect(() => {
    if (query.error) reportUnexpected("load-progress-list", query.error);
  }, [query.error]);

  if (query.isPending) return <Spinner label="Loading your progress…" />;

  const failure = query.error ? classifyWorkoutError(query.error, { op: "load-progress-list" }) : null;

  if (query.data === undefined) {
    return (
      <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void query.refetch()}>
        Couldn't load your progress
      </InlineNotice>
    );
  }

  const entries = groupByExercise(query.data);

  return (
    <>
      {query.isRefetchError ? (
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't refresh your progress
        </InlineNotice>
      ) : null}
      {entries.length === 0 ? (
        <div className={styles.empty}>
          <p>No records yet — finish a workout to see your progress</p>
          <Link className={styles.emptyLink} to="/app/workouts">
            Go to Workouts
          </Link>
        </div>
      ) : (
        <ul className={styles.list} aria-label="Exercises">
          {entries.map((entry) => {
            const selected = selectedId !== null && (entry.exerciseId === selectedId || entry.exerciseId === selectedRoot);
            return (
              <li key={entry.exerciseId}>
                <Link
                  className={selected ? `${styles.row} ${selection.selected}` : styles.row}
                  to={exercisePath(entry.exerciseId)}
                  state={FROM_RECORDS}
                  aria-current={selected ? "page" : undefined}
                >
                  <span className={styles.name} data-row-title="">
                    {entry.name}
                  </span>
                  <span className={styles.meta}>{headlineText(entry, unitPreference)}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
