import type { PersonalRecord, UnitPreference } from "@sin/core";

import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { FIRST_RECORD, recordParts } from "./labels";
import styles from "./RecordRows.module.css";

/**
 * The exercise page's records (Spec 17.11 AC7–AC9): one row per record, the label, the value, then a muted
 * "was 80 kg" or "First record". The exercise's name is the page's title, so no row repeats it. The ": " and ", "
 * are for screen readers only, so a row reads "Heaviest weight: 82.5 kg, was 80 kg". Draws in the order given.
 */
export function RecordRows({ records, unitPreference }: { records: readonly PersonalRecord[]; unitPreference: UnitPreference }) {
  return (
    <ul className={styles.list}>
      {records.map((record) => {
        const parts = recordParts(record, unitPreference);
        return (
          <li key={`${record.exerciseId}:${record.recordType}`} className={styles.row}>
            <span className={styles.label}>{parts.label}</span>
            <VisuallyHidden>: </VisuallyHidden>
            <span className={styles.value}>{parts.value}</span>
            <VisuallyHidden>, </VisuallyHidden>
            <span className={styles.was}>{parts.was === null ? FIRST_RECORD : `was ${parts.was}`}</span>
          </li>
        );
      })}
    </ul>
  );
}
