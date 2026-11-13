import type { Exercise } from "@sin/core";
import { useMemo } from "react";
import type { UseQueryResult } from "@tanstack/react-query";

import { useCatalog } from "../catalog/useCatalog";
import { useEquipment, useMuscleGroups } from "../catalog/referenceData";
import { detailRows, type RefState } from "./detailRows";
import styles from "./ExerciseDetails.module.css";

const refState = <T,>(query: UseQueryResult<T[]>): RefState<T> =>
  query.data !== undefined ? { status: "ok", rows: query.data } : query.isError ? { status: "error" } : { status: "pending" };

/** The exercise page's details (Spec 18.2 AC21): text only, never links. */
export function ExerciseDetails({ row }: { row: Exercise }) {
  const { state } = useCatalog();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const origin = useMemo(
    () => (row.forkedFromExerciseId === null ? null : (state.rows.find((r) => r.id === row.forkedFromExerciseId) ?? null)),
    [row.forkedFromExerciseId, state.rows],
  );
  const rows = detailRows(row, { muscles: refState(muscles), equipment: refState(equipment), origin });
  // Minor 515: the table has no label of its own; the disclosure's summary, "Exercise details", already names it.
  return (
    <dl className={styles.details}>
      {rows.map(({ label, value }) => (
        <div key={label} className={styles.row}>
          <dt className={styles.label}>{label}</dt>
          <dd className={styles.value}>{value ?? ""}</dd>
        </div>
      ))}
    </dl>
  );
}
