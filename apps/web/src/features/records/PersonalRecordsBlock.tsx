import { useEffect } from "react";
import type { UnitPreference, WorkoutDetail } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { FirstTimeLines } from "./FirstTimeLines";
import { useWorkoutRecords } from "./queries";
import { buildRecordLedger, type LedgerSection } from "./recordLedger";
import { RecordLedgerPanel } from "./RecordLedgerPanel";
import styles from "./PersonalRecordsBlock.module.css";

/**
 * The records this workout holds now, on the finished summary (Spec 08.0 §5.3, D14; the ledger since Spec 17.6). Renders
 * nothing while pending and nothing when there is nothing to show (set-volume records are not shown, 17.2 AC16); on a
 * failure its notice sits beside whatever it already shows, so the summary never waits on it (08.0 AC19, 17.6 AC1). The
 * panel holds only beaten records; first-ever numbers are quiet lines after it (17.6 AC12–AC13). Progress keeps
 * `RecordsSection`.
 */
export function PersonalRecordsBlock({ workoutId, unitPreference, workout, section }: { workoutId: string; unitPreference: UnitPreference; workout: Pick<WorkoutDetail, "exercises">; section: LedgerSection }) {
  const query = useWorkoutRecords(workoutId);

  useEffect(() => {
    if (query.error) reportUnexpected("load-records", query.error);
  }, [query.error]);

  if (query.isPending) return null;
  const ledger = buildRecordLedger({ records: query.data ?? [], workout, pref: unitPreference, section });
  if (!query.isError && ledger.heading === null && ledger.firsts.length === 0) return null;

  return (
    <div className={styles.block}>
      {query.isError ? (
        <InlineNotice tone="error" requestId={classifyWorkoutError(query.error, { op: "load-records" }).requestId} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't load records
        </InlineNotice>
      ) : null}
      {ledger.heading === null ? null : <RecordLedgerPanel heading={ledger.heading} lifts={ledger.lifts} />}
      {ledger.firsts.length === 0 ? null : <FirstTimeLines lines={ledger.firsts} />}
    </div>
  );
}
