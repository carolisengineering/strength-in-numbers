import { useParams } from "react-router";

import { ExerciseProgressScreen } from "../progress/ExerciseProgressScreen";

/** Interim (Spec 18.2 Task 3): the exercise page lands in Task 4. */
export function ExerciseRoute() {
  const { id = "" } = useParams();
  return <ExerciseProgressScreen key={id} exerciseId={id} />;
}
