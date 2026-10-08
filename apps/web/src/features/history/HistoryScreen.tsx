import { useEffect } from "react";
import { Link } from "react-router";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useMe } from "../me/useMe";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { HistoryRow } from "./HistoryRow";
import { flattenHistory, useHistoryList } from "./queries";
import styles from "./HistoryScreen.module.css";

/** Finished workouts, newest first, a page at a time (Spec 08.0 §5.2). "Load more", never infinite scroll (D3). */
export function HistoryScreen() {
  const query = useHistoryList();
  const { data: me } = useMe();
  const unitPreference = me?.unitPreference ?? "kg";

  useEffect(() => {
    if (query.error) reportUnexpected("load-history", query.error);
  }, [query.error]);

  if (query.isPending) return <Spinner label="Loading your history…" />;

  if (query.data === undefined) {
    const failure = classifyWorkoutError(query.error, { op: "load-history" });
    return (
      <Screen title="History">
        <InlineNotice tone="error" requestId={failure.requestId} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't load your history
        </InlineNotice>
      </Screen>
    );
  }

  const rows = flattenHistory(query.data.pages);

  return (
    <Screen title="History">
      {rows.length === 0 ? (
        <div className={styles.empty}>
          <p>No finished workouts yet</p>
          <Link className={styles.emptyLink} to="/app/workouts">
            Go to Workouts
          </Link>
        </div>
      ) : (
        <ul className={styles.list} aria-label="Finished workouts">
          {rows.map((workout) => (
            <li key={workout.id}>
              <HistoryRow workout={workout} unitPreference={unitPreference} />
            </li>
          ))}
        </ul>
      )}
      {query.hasNextPage ? (
        <div className={styles.more}>
          <Button variant="secondary" disabled={query.isFetchingNextPage} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </Screen>
  );
}
