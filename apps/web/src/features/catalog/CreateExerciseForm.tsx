import type { Equipment, Exercise, MuscleGroup } from "@sin/core";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../../api/problem";
import { Button } from "../../ui/Button";
import styles from "./CreateExerciseForm.module.css";
import {
  EMPTY_EXERCISE_FIELDS,
  ExerciseFields,
  toCreateExerciseInput,
  type ExerciseFieldName,
  type ExerciseFieldValues,
} from "./ExerciseFields";
import { EXERCISE_LIMIT_MESSAGE, mapExerciseFieldErrors } from "./fieldErrors";
import { useCatalog } from "./useCatalog";

type FieldName = ExerciseFieldName;

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
  const [values, setValues] = useState<ExerciseFieldValues>({ ...EMPTY_EXERCISE_FIELDS, name: initialName.trim() });
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldName, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // The sheet can close while a save is in flight. The POST still completes
  // (the row lands in the store), but a form that is gone must not report a
  // pick to a caller the user has already backed out of.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const canSave = values.name.trim() !== "" && values.modality !== null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = toCreateExerciseInput(values);
    if (!canSave || saving || input.modality === null) return;
    setSaving(true);
    setFormError(undefined);
    setFieldErrors({});

    try {
      const created = await createCustom({ ...input, modality: input.modality });
      if (mounted.current) onCreated(created);
    } catch (error) {
      if (!mounted.current) return;
      setSaving(false);
      if (
        error instanceof ApiError &&
        error.status === 409 &&
        error.type === "exercise-limit-reached"
      ) {
        setFormError(EXERCISE_LIMIT_MESSAGE);
        return;
      }
      if (error instanceof ApiError && error.isValidation()) {
        const mapped = mapExerciseFieldErrors(error);
        setFieldErrors(mapped.fieldErrors);
        // A message under a collapsed section would be invisible.
        if (mapped.openDetails) setDetailsOpen(true);
        if (mapped.formError !== undefined) setFormError(mapped.formError);
        return;
      }
      setFormError("Couldn't save. Try again.");
    }
  };

  return (
    <form className={styles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
      <ExerciseFields
        values={values}
        onChange={setValues}
        errors={fieldErrors}
        muscleGroups={muscleGroups}
        equipment={equipment}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
      />

      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="submit" busy={saving} disabled={!canSave}>
          Save
        </Button>
      </div>
    </form>
  );
}
