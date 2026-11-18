import { useMatch } from "react-router";

import { useIsDesktop } from "../../ui/breakpoints";
import { usePane } from "../../ui/paneContext";
import { Panes } from "../../ui/Panes";
import { Screen } from "../../ui/Screen";
import { useActiveWorkout } from "../workouts/queries";
import { WorkoutsScreen } from "../workouts/WorkoutsScreen";
import { CHOOSE_ROUTINE } from "./messages";
import { WORKOUTS_PATH } from "./paths";

/**
 * Spec 17.12 Phase D (AC25–AC29): the pathless layout of `/app/workouts`, `…/routines/:id` and `…/:id/edit`. With no
 * live workout, at desktop widths, Start and the routine list sit beside the open routine's preview or editor (the
 * child route, `<Outlet/>` in `Panes`). A live workout, or an active read still pending or failed with nothing cached,
 * passes `list={null}`: the single column at every width (D3), in the same detail slot, so a start or a resize never
 * remounts the editor and its draft. Below 64rem the active read isn't observed here, so a phone sends today's requests.
 */
export function RoutinesPanes() {
  const wide = useIsDesktop();
  const active = useActiveWorkout({ enabled: wide });
  const selectedId = useMatch(`${WORKOUTS_PATH}/routines/:id/*`)?.params.id ?? null;
  return <Panes list={wide && active.data === null ? <WorkoutsScreen /> : null} selectedId={selectedId} />;
}

/**
 * `/app/workouts` itself: the session or Start on a phone (and beside a live workout); "Choose a routine" in the detail
 * pane, the page's one `h1`, while the list pane beside it holds Start.
 */
export function WorkoutsIndex() {
  return usePane().slot === "detail" ? <Screen title={CHOOSE_ROUTINE} /> : <WorkoutsScreen />;
}
