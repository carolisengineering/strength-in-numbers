import { Link } from "react-router";
import type { UnitPreference, WorkoutSummary } from "@sin/core";
import { TrophyIcon } from "../../ui/icons";
import { formatVolumeKg } from "../units/format";
import { historyTimedLines } from "../sectionTimer/timedSectionLine";
import { timedMore } from "../sectionTimer/timerCopy";
import { formatLocalDate } from "../workouts/format";
import styles from "./HistoryScreen.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One finished workout (Spec 08.0 AC11, AC12): three lines, the whole row one link; never notes. The
 * first line ends with the workout's title (Spec 18.0 AC56), else the routine name (Spec 10.1 AC25). */
export function HistoryRow({ workout, unitPreference }: { workout: WorkoutSummary; unitPreference: UnitPreference }) {
  const more = workout.exerciseCount - workout.exerciseNames.length;
  const label = workout.title ?? workout.routineName;
  const volume = workout.totalVolume === null ? "" : ` · ${formatVolumeKg(workout.totalVolume, unitPreference)}`;
  // Spec 10.7 AC21: scored timed sections only, so a row with none (or only unscored ones) is unchanged.
  const timed = historyTimedLines(workout.timedSections);

  return (
    <Link className={styles.row} to={`/app/history/${encodeURIComponent(workout.id)}`}>
      <span className={styles.top}>
        <span className={styles.date}>
          {formatLocalDate(workout.localDate)}
          {label === null ? null : ` · ${label}`}
        </span>
        {workout.recordCount > 0 ? (
          <span className={styles.badge} role="img" aria-label={plural(workout.recordCount, "personal record", "personal records")}>
            <TrophyIcon />
            <span className={styles.badgeText} aria-hidden="true">
              {plural(workout.recordCount, "PR", "PRs")}
            </span>
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
      {timed.lines.map((line, i) => (
        <span key={i} className={styles.timed}>
          {line}
        </span>
      ))}
      {timed.more > 0 ? <span className={styles.timedMore}>{timedMore(timed.more)}</span> : null}
    </Link>
  );
}
