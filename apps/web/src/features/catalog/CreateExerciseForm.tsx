import {
  MODALITY_VALUES,
  type Equipment,
  type Exercise,
  type Modality,
  type MuscleGroup,
} from "@sin/core";
import { useState, type FormEvent } from "react";

import { ApiError } from "../../api/problem";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import styles from "./CreateExerciseForm.module.css";
import { MODALITY_LABELS } from "./labels";
import { useCatalog } from "./useCatalog";

const FIELD_NAMES = [
  "name",
  "modality",
  "primaryMuscleId",
  "secondaryMuscleIds",
  "equipmentId",
] as const;
type FieldName = (typeof FIELD_NAMES)[number];
const isFieldName = (value: string): value is FieldName =>
  (FIELD_NAMES as readonly string[]).includes(value);

const MAX_SECONDARY_MUSCLES = 4;

export interface CreateExerciseFormProps {
  /** Prefill for the name — the picker passes its search text. */
  initialName: string;
  /** Reference data; when either is `undefined` "More details" is omitted. */
  muscleGroups: readonly MuscleGroup[] | undefined;
  equipment: readonly Equipment[] | undefined;
  onCreated: (exercise: Exercise) => void;
  onCancel: () => void;
}

/**
 * Create a custom exercise (Spec 06.0 §5, AC28–AC29). Modality is asked up
 * front as large radio choices — it is the one field that changes what a
 * set-logging row looks like — and the optional catalog metadata sits under a
 * collapsed "More details". The write goes through `useCatalog().createCustom`
 * so Spec 06.2 can queue it.
 */
export function CreateExerciseForm({
  initialName,
  muscleGroups,
  equipment,
  onCreated,
  onCancel,
}: CreateExerciseFormProps) {
  const { createCustom } = useCatalog();
  const [name, setName] = useState(initialName.trim());
  const [modality, setModality] = useState<Modality | null>(null);
  const [primaryMuscleId, setPrimaryMuscleId] = useState("");
  const [secondaryMuscleIds, setSecondaryMuscleIds] = useState<string[]>([]);
  const [equipmentId, setEquipmentId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const canSave = name.trim() !== "" && modality !== null;

  const choosePrimary = (id: string) => {
    setPrimaryMuscleId(id);
    // The API rejects a secondary that restates the primary.
    setSecondaryMuscleIds((ids) => ids.filter((other) => other !== id));
  };

  const toggleSecondary = (id: string) => {
    setSecondaryMuscleIds((ids) =>
      ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id],
    );
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || saving || modality === null) return;
    setSaving(true);
    setFormError(undefined);
    setFieldErrors({});

    try {
      const created = await createCustom({
        name: name.trim(),
        modality,
        primaryMuscleId: primaryMuscleId === "" ? null : primaryMuscleId,
        secondaryMuscleIds,
        equipmentId: equipmentId === "" ? null : equipmentId,
      });
      onCreated(created);
    } catch (error) {
      setSaving(false);
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.type === "exercise-limit-reached"
      ) {
        setFormError("You've reached the maximum number of custom exercises.");
        return;
      }
      if (error instanceof ApiError && error.isValidation()) {
        const next: Partial<Record<FieldName, string>> = {};
        const unplaced: string[] = [];
        for (const { path, message } of error.errors) {
          // The API joins nested paths with "." (`secondaryMuscleIds.0`).
          const field = path.split(".")[0] ?? "";
          if (isFieldName(field)) next[field] ??= message;
          else unplaced.push(message);
        }
        setFieldErrors(next);
        if (unplaced.length > 0 || error.errors.length === 0) {
          setFormError(unplaced.join(" ") || "Some of these values were not accepted.");
        }
        return;
      }
      setFormError("Couldn't save. Try again.");
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
      <Field id="exercise-name" label="Name" error={fieldErrors.name}>
        {(control) => (
          <input
            {...control}
            type="text"
            maxLength={120}
            autoComplete="off"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>

      <fieldset className={styles.modality}>
        <legend className={styles.legend}>Modality</legend>
        <div className={styles.choices}>
          {MODALITY_VALUES.map((value) => (
            <label key={value} className={styles.choice}>
              <input
                type="radio"
                name="modality"
                value={value}
                checked={modality === value}
                onChange={() => setModality(value)}
              />
              {MODALITY_LABELS[value]}
            </label>
          ))}
        </div>
        {fieldErrors.modality ? (
          <p className={styles.fieldError} role="alert">
            {fieldErrors.modality}
          </p>
        ) : null}
      </fieldset>

      {muscleGroups !== undefined && equipment !== undefined ? (
        <details className={styles.details}>
          <summary className={styles.summary}>More details</summary>
          <div className={styles.detailsBody}>
            <Field
              id="exercise-primary-muscle"
              label="Primary muscle"
              error={fieldErrors.primaryMuscleId}
            >
              {(control) => (
                <select
                  {...control}
                  value={primaryMuscleId}
                  onChange={(event) => choosePrimary(event.target.value)}
                >
                  <option value="">—</option>
                  {muscleGroups.map((muscle) => (
                    <option key={muscle.id} value={muscle.id}>
                      {muscle.name}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <fieldset className={styles.modality}>
              <legend className={styles.legend}>Secondary muscles (up to 4)</legend>
              <div className={styles.choices}>
                {muscleGroups
                  .filter((muscle) => muscle.id !== primaryMuscleId)
                  .map((muscle) => {
                    const checked = secondaryMuscleIds.includes(muscle.id);
                    return (
                      <label key={muscle.id} className={styles.choice}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={
                            !checked && secondaryMuscleIds.length >= MAX_SECONDARY_MUSCLES
                          }
                          onChange={() => toggleSecondary(muscle.id)}
                        />
                        {muscle.name}
                      </label>
                    );
                  })}
              </div>
              {fieldErrors.secondaryMuscleIds ? (
                <p className={styles.fieldError} role="alert">
                  {fieldErrors.secondaryMuscleIds}
                </p>
              ) : null}
            </fieldset>

            <Field id="exercise-equipment" label="Equipment" error={fieldErrors.equipmentId}>
              {(control) => (
                <select
                  {...control}
                  value={equipmentId}
                  onChange={(event) => setEquipmentId(event.target.value)}
                >
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

      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" busy={saving} disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  );
}
