import { useMatch } from "react-router";

import { useIsDesktop } from "../../ui/breakpoints";
import { usePane } from "../../ui/paneContext";
import { Panes } from "../../ui/Panes";
import { Screen } from "../../ui/Screen";
import { useActiveWorkout } from "../workouts/queries";
import { useWaitingFinish } from "../workouts/useWaitingFinish";
import { WorkoutsNoticesContext, useWorkoutsNoticesStore } from "../workouts/workoutsNotices";
import { WorkoutsScreen } from "../workouts/WorkoutsScreen";
import { CHOOSE_ROUTINE } from "./messages";
import { WORKOUTS_PATH } from "./paths";

/**
 * Spec 17.12 Phase D (AC25–AC29): the pathless layout of `/app/workouts`, `…/routines/:id` and `…/:id/edit`. With no
 * live workout, at desktop widths, Start and the routine list sit beside the open routine's preview or editor (the
 * child route, `<Outlet/>` in `Panes`). A live workout, or an active read still pending or failed with nothing cached,
 * passes `list={null}`: the single column at every width (D3), in the same detail slot, so a start or a resize never
 * remounts the editor and its draft; so does a finish op in the outbox (Spec 06.7's cards are a whole screen). At
 * desktop widths it also holds the Workouts screen's notices, which move between the slots with it. Below 64rem the
 * active read isn't observed here, so a phone sends today's requests.
 */
export function RoutinesPanes() {
  const wide = useIsDesktop();
  const active = useActiveWorkout({ enabled: wide });
  // Spec 06.7 AC26 / AC30 (code review #2): a finish op in the outbox (waiting, or refused with its workout gone) is
  // the whole screen's card, so it keeps the single column even when no workout is active.
  const finishing = useWaitingFinish();
  const notices = useWorkoutsNoticesStore();
  const selectedId = useMatch(`${WORKOUTS_PATH}/routines/:id/*`)?.params.id ?? null;
  const list = wide && active.data === null && finishing.op === null ? <WorkoutsScreen /> : null;
  // The provider is always drawn (only its value changes with the width), so a resize never remounts the panes.
  return (
    <WorkoutsNoticesContext.Provider value={wide ? notices : null}>
      <Panes list={list} selectedId={selectedId} />
    </WorkoutsNoticesContext.Provider>
  );
}

/**
 * `/app/workouts` itself: the session or Start on a phone (and beside a live workout); "Choose a routine" in the detail
 * pane, the page's one `h1`, while the list pane beside it holds Start.
 */
export function WorkoutsIndex() {
  return usePane().slot === "detail" ? <Screen title={CHOOSE_ROUTINE} /> : <WorkoutsScreen />;
}
