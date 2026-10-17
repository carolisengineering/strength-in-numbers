import type { FinishStatsValue } from "./finishStats";
import styles from "./FinishDialog.module.css";
import { FinishStats } from "./FinishStatsList";
import type { UnloggedPlanned } from "./unloggedPlanned";

const sets = (n: number) => (n === 1 ? "1 set" : `${n} sets`);

/**
 * Spec 17.2 AC1-AC3: the body of both Finish dialogs: what you did, then (when planned sets are unlogged) the flag and the
 * per-exercise list, then the note. The dialogs' call, lock and waits live in `ConfirmDialog`'s owner and are not here.
 */
export function FinishDialogBody({ stats, unitPreference, unlogged, note }: { stats: FinishStatsValue; unitPreference: "kg" | "lb"; unlogged?: UnloggedPlanned; note: string }) {
  return (
    <div className={styles.body}>
      <FinishStats stats={stats} unitPreference={unitPreference} />
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
      <p>{note}</p>
    </div>
  );
}
