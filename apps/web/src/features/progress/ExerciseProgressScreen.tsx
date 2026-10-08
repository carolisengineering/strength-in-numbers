import { Link, useParams } from "react-router";
import { Screen } from "../../ui/Screen";
import styles from "./ExerciseProgressScreen.module.css";

/** Keys the screen by exercise so moving between exercises starts from defaults (§6.4). */
export function ExerciseProgressRoute() {
  const { exerciseId = "" } = useParams();
  return <ExerciseProgressScreen key={exerciseId} exerciseId={exerciseId} />;
}

export function ExerciseProgressScreen({ exerciseId }: { exerciseId: string }) {
  return (
    <Screen title="Exercise progress">
      <p hidden>{exerciseId}</p>
      <Link className={styles.back} to="/app/progress">
        Back to Progress
      </Link>
    </Screen>
  );
}
