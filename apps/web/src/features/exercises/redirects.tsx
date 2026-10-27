import { Navigate, useParams } from "react-router";

import { exercisePath } from "./paths";

/** `/app/progress/:exerciseId` → the exercise page, by replace (Spec 18.2 AC3); the id stays one segment. */
export function RedirectProgressExercise() {
  const { exerciseId = "" } = useParams();
  return <Navigate replace to={exercisePath(exerciseId)} />;
}
