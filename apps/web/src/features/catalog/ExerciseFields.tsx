import { MODALITY_VALUES, type Equipment, type Modality, type MuscleGroup } from "@sin/core";
import type { ReactNode } from "react";

import { Field } from "../../ui/Field";
import styles from "./ExerciseFields.module.css";
import { MODALITY_LABELS } from "./labels";

export interface ExerciseFieldValues {
  readonly name: string;
  readonly modality: Modality | null;
  /** "" = none. */
  readonly primaryMuscleId: string;
  readonly secondaryMuscleIds: readonly string[];
  /** "" = none. */
  readonly equipmentId: string;
}

export type ExerciseFieldName = "name" | "modality" | "primaryMuscleId" | "secondaryMuscleIds" | "equipmentId";

export const EMPTY_EXERCISE_FIELDS: ExerciseFieldValues = {
  name: "",
  modality: null,
  primaryMuscleId: "",
  secondaryMuscleIds: [],
  equipmentId: "",
};

/** The `POST /v1/exercises` body the values describe: trimmed name, "" → null. A null modality is left for the schema to refuse. */
export function toCreateExerciseInput(v: ExerciseFieldValues): {
  name: string;
  modality: Modality | null;
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
  equipmentId: string | null;
} {
  return {
    name: v.name.trim(),
    modality: v.modality,
    primaryMuscleId: v.primaryMuscleId === "" ? null : v.primaryMuscleId,
    secondaryMuscleIds: [...v.secondaryMuscleIds],
    equipmentId: v.equipmentId === "" ? null : v.equipmentId,
  };
}

const MAX_SECONDARY_MUSCLES = 4;

export interface ExerciseFieldsProps {
  values: ExerciseFieldValues;
  onChange: (next: ExerciseFieldValues) => void;
  errors?: Partial<Record<ExerciseFieldName, string>>;
  /** Default "exercise" → ids "exercise-name", "exercise-primary-muscle", "exercise-equipment"; group names `${idPrefix}-modality` / `${idPrefix}-secondary`. */
  idPrefix?: string;
  /** Default "Modality". */
  modalityLabel?: string;
  /** Reference data; when either is `undefined` "More details" is omitted. */
  muscleGroups: readonly MuscleGroup[] | undefined;
  equipment: readonly Equipment[] | undefined;
  detailsOpen: boolean;
  onDetailsOpenChange: (open: boolean) => void;
  /** Rendered directly under the Name field. */
  nameNotice?: ReactNode;
}

/**
 * The create-exercise inputs (Spec 06.0 §5, AC28; Spec 10.4 AC26, D13): Name, the modality as large
 * radio choices, and the optional catalog metadata under a collapsed "More details". Controlled, so
 * `CreateExerciseForm` and the import's New card share one set of fields.
 */
export function ExerciseFields({
  values,
  onChange,
  errors = {},
  idPrefix = "exercise",
  modalityLabel = "Modality",
  muscleGroups,
  equipment,
  detailsOpen,
  onDetailsOpenChange,
  nameNotice,
}: ExerciseFieldsProps) {
  const set = (patch: Partial<ExerciseFieldValues>) => onChange({ ...values, ...patch });

  const choosePrimary = (id: string) =>
    // The API rejects a secondary that restates the primary.
    set({ primaryMuscleId: id, secondaryMuscleIds: values.secondaryMuscleIds.filter((other) => other !== id) });

  const toggleSecondary = (id: string) =>
    set({
      secondaryMuscleIds: values.secondaryMuscleIds.includes(id)
        ? values.secondaryMuscleIds.filter((other) => other !== id)
        : [...values.secondaryMuscleIds, id],
    });

  return (
    <>
      <Field id={`${idPrefix}-name`} label="Name" error={errors.name}>
        {(control) => (
          <input
            {...control}
            type="text"
            maxLength={120}
            autoComplete="off"
            value={values.name}
            onChange={(event) => set({ name: event.target.value })}
          />
        )}
      </Field>
      {nameNotice}

      <fieldset className={styles.group}>
        <legend className={styles.legend}>{modalityLabel}</legend>
        <div className={styles.choices}>
          {MODALITY_VALUES.map((value) => (
            <label key={value} className={styles.choice}>
              <input
                type="radio"
                name={`${idPrefix}-modality`}
                value={value}
                checked={values.modality === value}
                onChange={() => set({ modality: value })}
              />
              {MODALITY_LABELS[value]}
            </label>
          ))}
        </div>
        {errors.modality ? (
          <p className={styles.fieldError} role="alert">
            {errors.modality}
          </p>
        ) : null}
      </fieldset>

      {muscleGroups !== undefined && equipment !== undefined ? (
        <details className={styles.details} open={detailsOpen} onToggle={(event) => onDetailsOpenChange(event.currentTarget.open)}>
          <summary className={styles.summary}>More details</summary>
          <div className={styles.detailsBody}>
            <Field id={`${idPrefix}-primary-muscle`} label="Primary muscle" error={errors.primaryMuscleId}>
              {(control) => (
                <select {...control} value={values.primaryMuscleId} onChange={(event) => choosePrimary(event.target.value)}>
                  <option value="">—</option>
                  {muscleGroups.map((muscle) => (
                    <option key={muscle.id} value={muscle.id}>
                      {muscle.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <fieldset className={styles.group}>
              <legend className={styles.legend}>Secondary muscles (up to 4)</legend>
              <div className={styles.choices}>
                {muscleGroups
                  .filter((muscle) => muscle.id !== values.primaryMuscleId)
                  .map((muscle) => {
                    const checked = values.secondaryMuscleIds.includes(muscle.id);
                    return (
                      <label key={muscle.id} className={styles.choice}>
                        <input
                          type="checkbox"
                          name={`${idPrefix}-secondary`}
                          checked={checked}
                          disabled={!checked && values.secondaryMuscleIds.length >= MAX_SECONDARY_MUSCLES}
                          onChange={() => toggleSecondary(muscle.id)}
                        />
                        {muscle.name}
                      </label>
                    );
                  })}
              </div>
              {errors.secondaryMuscleIds ? (
                <p className={styles.fieldError} role="alert">
                  {errors.secondaryMuscleIds}
                </p>
              ) : null}
            </fieldset>

            <Field id={`${idPrefix}-equipment`} label="Equipment" error={errors.equipmentId}>
              {(control) => (
                <select {...control} value={values.equipmentId} onChange={(event) => set({ equipmentId: event.target.value })}>
                  <option value="">—</option>
                  {equipment.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </div>
        </details>
      ) : null}
    </>
  );
}
