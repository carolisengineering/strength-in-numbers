import { useEffect, useRef } from "react";
import { Link, useLocation, useMatch } from "react-router";
import type { UnitPreference, WorkoutSummary } from "@sin/core";
import { TrophyIcon } from "../../ui/icons";
import { usePane } from "../../ui/paneContext";
import selection from "../../ui/selectedRow.module.css";
import { formatVolumeKg } from "../units/format";
import { historyTimedLines } from "../sectionTimer/timedSectionLine";
import { timedMore } from "../sectionTimer/timerCopy";
import { formatLocalDate } from "../workouts/format";
import { summaryEntryState } from "../workouts/summaryEntry";
import { hasOwnTitle } from "../workouts/WorkoutText";
import { historyBadgeText } from "./historyCopy";
import styles from "./HistoryScreen.module.css";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** One finished workout (Spec 08.0 AC11, AC12): three lines, the whole row one link; never notes. The
 * first line ends with the workout's title (Spec 18.0 AC56), else the routine name (Spec 10.1 AC25). */
export function HistoryRow({ workout, unitPreference }: { workout: WorkoutSummary; unitPreference: UnitPreference }) {
  const more = workout.exerciseCount - workout.exerciseNames.length;
  // Minor 599: a whitespace-only title is no title, as on the summary and in Edit (minor 543).
  const label = hasOwnTitle(workout) ? workout.title : workout.routineName;
  // Spec 07.6: the count is served as is (lifts with a beaten record); the web never re-derives it.
  const badge = historyBadgeText(workout.recordCount);
  const volume = workout.totalVolume === null ? "" : ` · ${formatVolumeKg(workout.totalVolume, unitPreference)}`;
  // Spec 10.7 AC21: scored timed sections only, so a row with none (or only unscored ones) is unchanged.
  const timed = historyTimedLines(workout.timedSections);
  // Spec 17.12 AC16: the workout open in the detail pane beside the list.
  const selected = usePane().selectedId === workout.id;
  // Minor 653: a deep link at desktop widths can open a workout whose row sits below the list pane's fold. `nearest`
  // never moves a row that is already in view, so a click on a row doesn't scroll. Minor 695: only when the route
  // names this workout; a derived selection (the newest, or the next after a delete) leaves the list where it is.
  const routeId = useMatch("/app/history/:id/*")?.params.id ?? null;
  const scrollTo = selected && routeId === workout.id;
  const ref = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (scrollTo) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [scrollTo]);
  // Minor 696: a row on the list itself marks the summary as opened from it, so a delete there goes Back.
  const { pathname } = useLocation();

  return (
    <Link
      ref={ref}
      className={selected ? `${styles.row} ${selection.selected}` : styles.row}
      to={`/app/history/${encodeURIComponent(workout.id)}`}
      state={summaryEntryState(pathname, "/app/history")}
      aria-current={selected ? "page" : undefined}
    >
      <span className={styles.top} data-row-title="">
        <span className={styles.date}>{formatLocalDate(workout.localDate)}</span>
        {/* A no-break space: a flex item drops an ordinary leading space, and `pre` would keep a title's own runs of spaces. */}
        {label === null ? null : <span className={styles.label}>{`\u00a0· ${label}`}</span>}
        {workout.recordCount > 0 ? (
          <span className={styles.badge} role="img" aria-label={badge.name}>
            <TrophyIcon />
            <span className={styles.badgeText} aria-hidden="true">
              {badge.visible}
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
