import { useEffect, useId } from "react";
import type { UnitPreference } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { recordLine, sortRecords } from "./labels";
import { useWorkoutRecords } from "./queries";
import styles from "./PersonalRecordsBlock.module.css";

/**
 * The records this workout holds now (Spec 08.0 §5.3, D14). Renders nothing while pending or when
 * there are none, and its own notice on failure: it is a sibling of the exercise sections, so the
 * summary never waits on it (AC19).
 */
export function PersonalRecordsBlock({ workoutId, unitPreference }: { workoutId: string; unitPreference: UnitPreference }) {
  const query = useWorkoutRecords(workoutId);
  const headingId = useId();

  useEffect(() => {
    if (query.error) reportUnexpected("load-records", query.error);
  }, [query.error]);

  if (query.isPending) return null;
  if (!query.isError && query.data.length === 0) return null;

  return (
    <section className={styles.block} aria-labelledby={headingId}>
      <h2 className={styles.heading} id={headingId}>
        Personal records
      </h2>
      {query.isError ? (
        <InlineNotice
          tone="error"
          requestId={classifyWorkoutError(query.error, { op: "load-records" }).requestId}
          actionLabel="Try again"
          onAction={() => void query.refetch()}
        >
          Couldn't load records
        </InlineNotice>
      ) : (
        <ul className={styles.list}>
          {sortRecords(query.data).map((record) => (
            <li key={`${record.exerciseId}:${record.recordType}`}>{recordLine(record, unitPreference)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
