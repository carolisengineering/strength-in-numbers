import { usePane } from "../../ui/paneContext";
import { Screen } from "../../ui/Screen";
import { ExerciseScreen } from "./ExerciseScreen";
import { ExercisesListScreen, type ExercisesView } from "./ExercisesListScreen";
import { EXERCISES_COPY } from "./messages";
import { useExerciseList } from "./useExerciseList";

/**
 * `/app/exercises` and `/app/exercises/records` (Spec 17.12 AC21). On a phone, the list in that view, as today. At
 * desktop widths the list is the pane beside, so this is the selected (most recently logged) exercise's page, keyed by
 * id; "Choose an exercise" as the detail's one `h1` once usage and the catalog have answered with nothing logged;
 * nothing (and so no `h1`, D8) while they haven't, or if usage failed (the list pane says so).
 */
export function ExercisesIndex({ view }: { view: ExercisesView }) {
  const { slot, selectedId } = usePane();
  if (slot === null) return <ExercisesListScreen view={view} />;
  if (selectedId !== null) return <ExerciseScreen key={selectedId} exerciseId={selectedId} />;
  return <ChooseExercise />;
}

function ChooseExercise() {
  const { usage, catalogReady } = useExerciseList();
  return usage.data !== undefined && catalogReady ? <Screen title={EXERCISES_COPY.chooseExercise} /> : null;
}
