import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router";
import { reportError } from "../../observability/reportError";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";
import { Spinner } from "../../ui/Spinner";
import { useMe } from "../me/useMe";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { HistoryRow } from "./HistoryRow";
import { HISTORY_KEYS, flattenHistory, isStaleCursor, useHistoryList } from "./queries";
import styles from "./HistoryScreen.module.css";

/** Finished workouts, newest first, a page at a time (Spec 08.0 §5.2). "Load more", never infinite scroll (D3). */
export function HistoryScreen() {
  const query = useHistoryList();
  const queryClient = useQueryClient();
  const { data: me } = useMe();
  const unitPreference = me?.unitPreference ?? "kg";
  // One silent reset per mount: a server that keeps answering 422 cannot become a request loop (AC17).
  const resetUsed = useRef(false);
  const resetting = isStaleCursor(query.error) && !resetUsed.current;

  useEffect(() => {
    if (!query.error) return;
    if (isStaleCursor(query.error)) {
      // `validation` is an expected kind, so `reportUnexpected` would drop it: report every time (§5.4).
      reportError(query.error, { source: "history", op: "stale-cursor" });
      if (!resetUsed.current) {
        resetUsed.current = true;
        void queryClient.resetQueries({ queryKey: HISTORY_KEYS.list });
      }
      return;
    }
    reportUnexpected("load-history", query.error);
  }, [query.error, queryClient]);

  // Retrying a dead cursor can only fail again: a stale-cursor error restarts from page 1 instead.
  const retryNextPage = () =>
    void (isStaleCursor(query.error) ? queryClient.resetQueries({ queryKey: HISTORY_KEYS.list }) : query.fetchNextPage());

  if (query.isPending || resetting) return <Spinner label="Loading your history…" />;

  const failure = query.error ? classifyWorkoutError(query.error, { op: "load-history" }) : null;

  if (query.data === undefined) {
    return (
      <Screen title="History">
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't load your history
        </InlineNotice>
      </Screen>
    );
  }

  const rows = flattenHistory(query.data.pages);

  return (
    <Screen title="History">
      {query.isRefetchError ? (
        <InlineNotice tone="error" requestId={failure?.requestId ?? null} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't refresh your history
        </InlineNotice>
      ) : null}
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
      {query.isFetchNextPageError ? (
        <InlineNotice
          tone="error"
          requestId={failure?.requestId ?? null}
          actionLabel="Try again"
          onAction={retryNextPage}
        >
          Couldn't load more
        </InlineNotice>
      ) : query.hasNextPage ? (
        <div className={styles.more}>
          {/* Disabled during any fetch: `fetchNextPage` would cancel an in-flight refresh and keep stale rows. */}
          <Button variant="secondary" disabled={query.isFetching} onClick={() => void query.fetchNextPage()}>
            {query.isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      ) : null}
    </Screen>
  );
}
