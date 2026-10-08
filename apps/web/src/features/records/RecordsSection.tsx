import { useEffect, useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PersonalRecord, UnitPreference } from "@sin/core";
import { InlineNotice } from "../../ui/InlineNotice";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { recordLine, sortRecords } from "./labels";
import styles from "./PersonalRecordsBlock.module.css";

/**
 * The "Personal records" section for any records query (Spec 08.0 §6.5; extracted for 08.1 D13).
 * Renders nothing while pending or when there are none, and its own notice on failure: it is a
 * sibling of whatever it sits beside, so that never waits on it (08.0 AC19).
 */
export function RecordsSection({
  query,
  unitPreference,
}: {
  query: UseQueryResult<PersonalRecord[]>;
  unitPreference: UnitPreference;
}) {
  const headingId = useId();

  useEffect(() => {
    if (query.error) reportUnexpected("load-records", query.error);
  }, [query.error]);

  if (query.isPending) return null;
  // A failed refresh keeps the records already shown; the notice sits beside them.
  const records = query.data ?? [];
  if (!query.isError && records.length === 0) return null;

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
      ) : null}
      {records.length > 0 ? (
        <ul className={styles.list}>
          {sortRecords(records).map((record) => (
            <li key={`${record.exerciseId}:${record.recordType}`}>{recordLine(record, unitPreference)}</li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
