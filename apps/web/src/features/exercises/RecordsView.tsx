import { useEffect } from "react";
import { Link } from "react-router";
import { InlineNotice } from "../../ui/InlineNotice";
import { Spinner } from "../../ui/Spinner";
import { useMe } from "../me/useMe";
import { groupByExercise, headlineText } from "../progress/exercises";
import { useAllRecords } from "../records/queries";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { exercisePath, FROM_RECORDS } from "./paths";
import styles from "./RecordsView.module.css";

/**
 * Exercises the lifter holds records for, newest record first (Spec 08.1 §5.2, D6): the Exercises tab's
 * Records view (Spec 18.2 AC6). The layout draws the `Screen`; each row opens the exercise page.
 */
export function RecordsView() {
  const query = useAllRecords();
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
          {entries.map((entry) => (
            <li key={entry.exerciseId}>
              <Link className={styles.row} to={exercisePath(entry.exerciseId)} state={FROM_RECORDS}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.meta}>{headlineText(entry, unitPreference)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
