import type { FinishStatsValue } from "./finishStats";
import { formatStartedAt } from "./format";
import styles from "./FinishDialog.module.css";
import { FinishStats } from "./FinishStatsList";
import { KEEP_IN_ROUTINES, oneOffFinishLine } from "./messages";
import type { UnloggedPlanned } from "./unloggedPlanned";

const sets = (n: number) => (n === 1 ? "1 set" : `${n} sets`);

/** Spec 10.5 AC11: the workout came from a one-off routine; `keep` rides on the finish as `keepRoutine`. */
export interface FinishOneOff {
  readonly name: string;
  readonly keep: boolean;
  readonly onKeepChange: (keep: boolean) => void;
}

/**
 * Spec 17.2 AC1-AC3: the body of both Finish dialogs: what you did, then (when planned sets are unlogged) the flag and the
 * per-exercise list, then (Spec 10.5, from a one-off routine) its line and the Keep checkbox, then the note (Spec 18.0 D21: optional; only End early has one). With a plan (Spec 18.0 AC38) the
 * end time follows the stats. The dialogs' call, lock and waits live in `ConfirmDialog`'s owner and are not here.
 */
export function FinishDialogBody({
  stats,
  unitPreference,
  unlogged,
  note,
  endsAt,
  oneOff,
}: {
  stats: FinishStatsValue;
  unitPreference: "kg" | "lb";
  unlogged?: UnloggedPlanned;
  note?: string;
  endsAt?: string;
  oneOff?: FinishOneOff;
}) {
  return (
    <div className={styles.body}>
      <FinishStats stats={stats} unitPreference={unitPreference} />
      {endsAt ? <p>Ends {formatStartedAt(endsAt)}, as set in Change Time.</p> : null}
      {unlogged && unlogged.total > 0 ? (
        <>
          <p>{unlogged.total === 1 ? "1 planned set not logged" : `${unlogged.total} planned sets not logged`}</p>
          <ul className={styles.list}>
            {unlogged.byExercise.map((e) => (
              <li key={e.id}>
                {e.name} · {sets(e.count)}
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {oneOff ? (
        <>
          <p className={styles.oneOffLine}>{oneOffFinishLine(oneOff.name)}</p>
          <label className={styles.keep}>
            <input className={styles.keepBox} type="checkbox" checked={oneOff.keep} onChange={(e) => oneOff.onKeepChange(e.currentTarget.checked)} />
            {KEEP_IN_ROUTINES}
          </label>
        </>
      ) : null}
      {note ? <p>{note}</p> : null}
    </div>
  );
}
