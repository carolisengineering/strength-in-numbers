import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useMatch } from "react-router";

import { useIsDesktop } from "../../ui/breakpoints";
import { Panes } from "../../ui/Panes";
import { useSelectedId } from "../../ui/selection";
import { mostRecentLoggedId } from "./exerciseRows";
import { ExercisesLayoutContext } from "./exercisesLayoutState";
import { ExercisesListScreen, type ExercisesView } from "./ExercisesListScreen";
import { EXERCISES_PATH, isFromRecords, RECORDS_PATH } from "./paths";
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
  // Matched like the route (a trailing slash, any case), never compared as a string (code review #6).
  const onRecords = useMatch(RECORDS_PATH) !== null;
  // A layout's `useParams` doesn't see its child's `:id`; the static `records` segment would match `:id` here too.
  const match = useMatch(`${EXERCISES_PATH}/:id`);
  const routeId = onRecords ? null : (match?.params.id ?? null);
  const { rows, usage } = useExerciseList({ enabled: wide });
  const recent = usage.data === undefined ? null : mostRecentLoggedId(rows, usage.data);
  const derived = useSelectedId(routeId, recent === null ? NONE : [recent]);
  // Minor 659: a page deleting the exercise that opened by default holds it until the delete's navigation, or the row
  // leaving the catalog would move the derived selection first and unmount the page and its dialog.
  // Tied to the entry it was taken on, so it lapses in the very render the navigation lands (an effect would leave one
  // render where the index mounts the deleted exercise's page afresh and flashes its deleted variant).
  const [held, setHeld] = useState<{ id: string; key: string } | null>(null);
  const hold = useCallback((id: string | null) => setHeld(id === null ? null : { id, key: location.key }), [location.key]);
  useEffect(() => setHeld(null), [location.key]);
  const selectedId = held !== null && held.key === location.key ? held.id : derived;
  // Minor 662: the search text lives here, so the list keeps it when a resize moves it between the index and the pane.
  // Below 64rem every navigation clears it, as when the phone's list unmounted and came back.
  const [query, setQuery] = useState("");
  const lastPath = useRef(location.pathname);
  useEffect(() => {
    if (lastPath.current === location.pathname) return;
    lastPath.current = location.pathname;
    if (!wide) setQuery("");
  }, [location.pathname, wide]);
  const state = useMemo(() => ({ hold, query, setQuery }), [hold, query]);
  const listView: ExercisesView = onRecords || (routeId !== null && isFromRecords(location.state)) ? "records" : "all";
  return (
    <ExercisesLayoutContext.Provider value={state}>
      <Panes list={<ExercisesListScreen view={listView} />} selectedId={selectedId} />
    </ExercisesLayoutContext.Provider>
  );
}

const NONE: readonly string[] = [];
