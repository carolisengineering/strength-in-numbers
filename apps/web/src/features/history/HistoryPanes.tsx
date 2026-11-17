import { useMemo } from "react";
import { useMatch, useParams } from "react-router";

import { useIsDesktop } from "../../ui/breakpoints";
import { usePane } from "../../ui/paneContext";
import { Panes } from "../../ui/Panes";
import { useSelectedId } from "../../ui/selection";
import { EditWorkoutScreen } from "../workouts/edit/EditWorkoutScreen";
import { FinishedWorkoutScreen } from "../workouts/FinishedWorkoutScreen";
import { HistoryScreen } from "./HistoryScreen";
import { flattenHistory, useHistoryList } from "./queries";

/**
 * Spec 17.12 Phase B (AC14–AC18): History's layout route. At desktop widths the workout list sits beside the open
 * workout; the detail is the child route (`<Outlet/>` in `Panes`), so the URLs are today's. The selection is derived:
 * the route's id, else the newest workout (AC15, no redirect). Below 64rem `Panes` draws only the child route and the
 * list query isn't even observed here (`enabled` only when wide), so the phone sends exactly today's requests.
 */
export function HistoryPanes() {
  const wide = useIsDesktop();
  // A layout's `useParams` doesn't see its child's `:id`.
  const routeId = useMatch("/app/history/:id/*")?.params.id ?? null;
  const list = useHistoryList({ enabled: wide });
  const ids = useMemo(() => flattenHistory(list.data?.pages ?? []).map((row) => row.id), [list.data]);
  const selectedId = useSelectedId(routeId, ids);
  return <Panes list={<HistoryScreen />} listLabel="History" detailLabel="Workout" selectedId={selectedId} />;
}

/**
 * `/app/history` itself. On a phone it is the list, as today. At desktop widths the list is the pane beside, so this is
 * the selected (newest) workout's summary, or nothing while there's none: no workouts, the list still loading, or the
 * list failed (the list pane says which). Keyed by id, so a new newest is a fresh summary.
 */
export function HistoryIndex() {
  const { slot, selectedId } = usePane();
  if (slot === null) return <HistoryScreen />;
  return selectedId === null ? null : <FinishedWorkoutScreen key={selectedId} section="history" workoutId={selectedId} />;
}

/**
 * `/app/history/:id` and `…/:id/edit`, keyed by the id (code review): beside the list, a click goes from one workout
 * to the next without leaving the route, and an already-read workout would reuse the last one's screen state (an open
 * Workout menu, a failure notice, the saved message). On a phone the list was always in between.
 */
export function HistoryWorkout() {
  const { id = "" } = useParams();
  return <FinishedWorkoutScreen key={id} section="history" />;
}

export function HistoryWorkoutEdit() {
  const { id = "" } = useParams();
  return <EditWorkoutScreen key={id} section="history" />;
}
