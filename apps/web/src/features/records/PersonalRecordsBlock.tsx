import { useEffect, useId } from "react";
import type { UnitPreference, WorkoutDetail } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { buildRecordCards, recordsNewCount } from "./recordCards";
import { RecordCards } from "./RecordCardList";
import { useWorkoutRecords } from "./queries";
import styles from "./PersonalRecordsBlock.module.css";

/**
 * The records this workout holds now, on the finished summary (Spec 08.0 §5.3, D14; cards since Spec 17.2). Renders nothing
 * while pending, nothing when there is nothing to show (set-volume records are not shown here, AC16), and its own notice on
 * failure beside any cards already shown: the summary never waits on it (08.0 AC19, 17.2 AC28). Progress keeps
 * `RecordsSection`.
 */
export function PersonalRecordsBlock({ workoutId, unitPreference, workout }: { workoutId: string; unitPreference: UnitPreference; workout: Pick<WorkoutDetail, "exercises"> }) {
  const query = useWorkoutRecords(workoutId);
  const headingId = useId();

  useEffect(() => {
    if (query.error) reportUnexpected("load-records", query.error);
  }, [query.error]);

  if (query.isPending) return null;
  const records = query.data ?? [];
  const cards = buildRecordCards({ records, workout, pref: unitPreference });
  if (!query.isError && cards.length === 0) return null;

  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <div className={styles.header}>
        <h2 className={styles.heading} id={headingId}>
          Personal records
        </h2>
        {cards.length > 0 ? <p className={styles.count}>{recordsNewCount(records)} new</p> : null}
      </div>
      {query.isError ? (
        <InlineNotice tone="error" requestId={classifyWorkoutError(query.error, { op: "load-records" }).requestId} actionLabel="Try again" onAction={() => void query.refetch()}>
          Couldn't load records
        </InlineNotice>
      ) : null}
      {cards.length > 0 ? <RecordCards cards={cards} /> : null}
    </section>
  );
}
