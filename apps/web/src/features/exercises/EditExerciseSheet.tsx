import { lineageRootId, type Exercise } from "@sin/core";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ApiError } from "../../api/problem";
import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import formStyles from "../catalog/CreateExerciseForm.module.css";
import { ExerciseFields, type ExerciseFieldName, type ExerciseFieldValues } from "../catalog/ExerciseFields";
import fieldStyles from "../catalog/ExerciseFields.module.css";
import { mapExerciseFieldErrors } from "../catalog/fieldErrors";
import { useEquipment, useMuscleGroups } from "../catalog/referenceData";
import { useCatalog } from "../catalog/useCatalog";
import { classifyExerciseError, exerciseErrorMessage } from "./exerciseErrors";
import { disabledModalitiesFor, modalityNotes, toUpdateExerciseInput, valuesFromExercise, type UsageKnowledge } from "./exerciseInput";
import { EXERCISE_KEYS } from "./keys";
import { EXERCISES_COPY } from "./messages";
import { useExerciseUsage } from "./usage";
import { useUpdateExercise } from "./useExerciseMutations";

export interface EditExerciseSheetProps {
  open: boolean;
  row: Exercise;
  onClose: () => void;
  onSaved: () => void;
  /** The row turned out to be deleted (AC42): the page shows that, with its status line. */
  onGone: () => void;
}

/**
 * Edit an own exercise or copy (Spec 18.2 §6.5, AC35–AC42): `ExerciseFields` with the type rule applied, only the
 * changed fields sent. The form mounts only while open, so each opening starts from the row and asks usage again.
 */
export function EditExerciseSheet({ open, row, onClose, onSaved, onGone }: EditExerciseSheetProps) {
  const [saving, setSaving] = useState(false);
  return (
    <Sheet open={open} title={EXERCISES_COPY.editTitle} onClose={onClose} dismissible={!saving}>
      {open ? <EditForm row={row} onCancel={onClose} onSaved={onSaved} onGone={onGone} onSavingChange={setSaving} /> : null}
    </Sheet>
  );
}

function EditForm({
  row,
  onCancel,
  onSaved,
  onGone,
  onSavingChange,
}: {
  row: Exercise;
  onCancel: () => void;
  onSaved: () => void;
  onGone: () => void;
  onSavingChange: (saving: boolean) => void;
}) {
  const usage = useExerciseUsage();
  const muscles = useMuscleGroups();
  const equipment = useEquipment();
  const { refresh } = useCatalog();
  const queryClient = useQueryClient();
  const update = useUpdateExercise();
  const [initial] = useState(() => valuesFromExercise(row));
  const [values, setValues] = useState<ExerciseFieldValues>(initial);
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<ExerciseFieldName, string>>>({});
  const [formError, setFormError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  // AC38: options must reflect sets logged since the tab was last viewed (a 304 when unchanged).
  const { refetch } = usage;
  useEffect(() => {
    // Joins a read already in flight (the page's own) rather than cancelling it.
    void refetch({ cancelRefetch: false });
  }, [refetch]);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const knowledge: UsageKnowledge =
    usage.data !== undefined
      ? { status: "known", hasLoggedSets: usage.data.has(lineageRootId(row)) }
      : usage.isPending
        ? { status: "pending" }
        : { status: "failed" };
  const patch = toUpdateExerciseInput(initial, values);
  const canSave = values.name.trim() !== "" && Object.keys(patch).length > 0;
  const notes = modalityNotes(row.modality, values.modality ?? row.modality, knowledge);

  const setBusy = (busy: boolean) => {
    setSaving(busy);
    onSavingChange(busy);
  };

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canSave || saving) return;
    setBusy(true);
    setFormError(undefined);
    setFieldErrors({});
    try {
      await update.mutateAsync({ id: row.id, patch });
      onSavingChange(false);
      if (mounted.current) onSaved();
    } catch (error) {
      const kind = classifyExerciseError(error);
      if (kind === "gone" || kind === "built-in") await refresh(true);
      onSavingChange(false);
      // The refresh has dropped the row, so the page re-rendered as deleted and this form is gone: the page's
      // callback still runs (it only sets page state).
      if (kind === "gone") {
        onGone();
        return;
      }
      if (!mounted.current) return;
      setSaving(false);
      if (kind === "type-locked") {
        // AC41: the only programmatic reset; every other edit stays.
        setValues((current) => ({ ...current, modality: row.modality }));
        setFormError(EXERCISES_COPY.typeLocked);
        void queryClient.invalidateQueries({ queryKey: EXERCISE_KEYS.usage });
        return;
      }
      if (kind === "validation" && error instanceof ApiError) {
        const mapped = mapExerciseFieldErrors(error);
        setFieldErrors(mapped.fieldErrors);
        if (mapped.openDetails) setDetailsOpen(true);
        if (mapped.formError !== undefined) setFormError(mapped.formError);
        return;
      }
      setFormError(exerciseErrorMessage(kind, "update") ?? undefined);
    }
  };

  return (
    <form className={formStyles.form} onSubmit={(event) => void onSubmit(event)} noValidate>
      <ExerciseFields
        idPrefix="edit-exercise"
        modalityLabel={EXERCISES_COPY.typeLabel}
        values={values}
        onChange={setValues}
        errors={fieldErrors}
        muscleGroups={muscles.data}
        equipment={equipment.data}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        nameNotice={<p className={fieldStyles.hint}>{EXERCISES_COPY.renameNote}</p>}
        disabledModalities={disabledModalitiesFor(row.modality, knowledge)}
        modalityNotice={
          notes.length > 0 ? (
            <>
              {notes.map((note) => (
                <p key={note} className={fieldStyles.hint}>
                  {note}
                </p>
              ))}
            </>
          ) : null
        }
      />
      {formError ? (
        <p className={formStyles.formError} role="alert">
          {formError}
        </p>
      ) : null}
      <div className={formStyles.actions}>
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {EXERCISES_COPY.cancel}
        </Button>
        <Button type="submit" busy={saving} disabled={!canSave}>
          {EXERCISES_COPY.save}
        </Button>
      </div>
    </form>
  );
}
