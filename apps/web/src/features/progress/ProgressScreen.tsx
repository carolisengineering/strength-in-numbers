import { useEffect } from "react";
import { Link } from "react-router";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useMe } from "../me/useMe";
import { useAllRecords } from "../records/queries";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { groupByExercise, headlineText } from "./exercises";
import styles from "./ProgressScreen.module.css";

/** Exercises the lifter holds records for, newest record first (Spec 08.1 §5.2, D6). */
export function ProgressScreen() {
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
      <Screen title="Progress">
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't load your progress
        </InlineNotice>
      </Screen>
    );
  }

  const entries = groupByExercise(query.data);

  return (
    <Screen title="Progress">
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
              <Link className={styles.row} to={`/app/progress/${encodeURIComponent(entry.exerciseId)}`}>
                <span className={styles.name}>{entry.name}</span>
                <span className={styles.meta}>{headlineText(entry, unitPreference)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Screen>
  );
}
