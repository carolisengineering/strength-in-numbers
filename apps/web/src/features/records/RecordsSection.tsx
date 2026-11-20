import { useEffect, useId } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import type { PersonalRecord, UnitPreference } from "@sin/core";
import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { classifyWorkoutError } from "../workouts/errors";
import { reportUnexpected } from "../workouts/reportUnexpected";
import { sortRecords } from "./labels";
import styles from "./PersonalRecordsBlock.module.css";
import { RecordRows } from "./RecordRows";
import { recordsToShow, REPS_AT_WEIGHT_SHOWN } from "./repsAtWeightRows";
import { useCollapseToggle } from "./useCollapseToggle";

/**
 * The "Personal records" section for one exercise's records query (Spec 08.0 §6.5; extracted for 08.1 D13). The
 * records are one lineage: rows carry no exercise name, and `sortRecords` orders by type and weight only (07.5 AC39).
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
  // 07.5 AC39: local and never stored, like the ledger's (17.6 AC11).
  const { expanded, toggle, buttonRef } = useCollapseToggle();

  useEffect(() => {
    if (query.error) reportUnexpected("load-records", query.error);
  }, [query.error]);

  if (query.isPending) return null;
  // A failed refresh keeps the records already shown; the notice sits beside them.
  const records = query.data ?? [];
  if (!query.isError && records.length === 0) return null;
  const { shown, weights } = recordsToShow(sortRecords(records), expanded);

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
      {shown.length > 0 ? <RecordRows records={shown} unitPreference={unitPreference} /> : null}
      {weights > REPS_AT_WEIGHT_SHOWN ? (
        <Button ref={buttonRef} variant="secondary" aria-expanded={expanded} onClick={toggle}>
          {expanded ? "Show fewer" : `Show all ${weights} weights`}
        </Button>
      ) : null}
    </section>
  );
}
