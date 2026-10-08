import { Link } from "react-router";
import type { UnitPreference, WorkoutSummary } from "@sin/core";
import { formatVolumeKg } from "../units/format";
import { formatLocalDate } from "../workouts/format";
import styles from "./HistoryScreen.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One finished workout (Spec 08.0 AC11, AC12): three lines, the whole row one link; never notes. */
export function HistoryRow({ workout, unitPreference }: { workout: WorkoutSummary; unitPreference: UnitPreference }) {
  const more = workout.exerciseCount - workout.exerciseNames.length;
  const volume = workout.totalVolume === null ? "" : ` · ${formatVolumeKg(workout.totalVolume, unitPreference)}`;

  return (
    <Link className={styles.row} to={`/app/history/${encodeURIComponent(workout.id)}`}>
      <span className={styles.top}>
        <span>{formatLocalDate(workout.localDate)}</span>
        {workout.recordCount > 0 ? (
          <span role="img" aria-label={plural(workout.recordCount, "personal record", "personal records")}>
            {"\u{1F3C6}"}
          </span>
        ) : null}
      </span>
      <span className={styles.names}>
        {workout.exerciseNames.join(", ")}
        {more > 0 ? ` +${more}` : ""}
      </span>
      <span className={styles.meta}>
        {plural(workout.workingSetCount, "set", "sets")}
        {volume}
      </span>
    </Link>
  );
}
