import { useLocation, useMatch } from "react-router";

import { useIsDesktop } from "../../ui/breakpoints";
import { Panes } from "../../ui/Panes";
import { useSelectedId } from "../../ui/selection";
import { mostRecentLoggedId } from "./exerciseRows";
import { ExercisesListScreen, type ExercisesView } from "./ExercisesListScreen";
import { isFromRecords, RECORDS_PATH } from "./paths";
import { useExerciseList } from "./useExerciseList";

/**
 * Spec 17.12 Phase C (AC20–AC22): the Exercises tab's layout route. At desktop widths the list (All exercises or
 * Records, with its switch) sits beside the open exercise's page; the detail is the child route, so the URLs are
 * Spec 18.2's. The selection is derived: the route's id, else the most recently logged exercise (AC21, no redirect),
 * else none. Below 64rem `Panes` draws only the child route, and the usage read is observed here only when wide, so
 * the phone sends exactly today's requests.
 */
export function ExercisesLayout() {
  const wide = useIsDesktop();
  const location = useLocation();
  const onRecords = location.pathname === RECORDS_PATH;
  // A layout's `useParams` doesn't see its child's `:id`; the static `records` segment would match `:id` here too.
  const match = useMatch("/app/exercises/:id");
  const routeId = onRecords ? null : (match?.params.id ?? null);
  const { rows, usage } = useExerciseList({ enabled: wide });
  const recent = usage.data === undefined ? null : mostRecentLoggedId(rows, usage.data);
  const selectedId = useSelectedId(routeId, recent === null ? NONE : [recent]);
  const listView: ExercisesView = onRecords || (routeId !== null && isFromRecords(location.state)) ? "records" : "all";
  return <Panes list={<ExercisesListScreen view={listView} />} selectedId={selectedId} />;
}

const NONE: readonly string[] = [];
