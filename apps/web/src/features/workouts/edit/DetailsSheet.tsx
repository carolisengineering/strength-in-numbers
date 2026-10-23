import { useRef, useState, type FormEvent } from "react";
import { WORKOUT_NOTES_MAX, WORKOUT_TITLE_MAX, type WorkoutDetail } from "@sin/core";

import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Sheet } from "../../../ui/Sheet";
import styles from "../NoteSheet.module.css";
import sheetStyles from "../SetEditSheet.module.css";
import { reportUnexpected } from "../reportUnexpected";
import type { EditScreenMode } from "../screenMode";
import { buildPatch, initialForm, validate, type DetailsField, type DetailsForm } from "./details";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure } from "./editFailure";
import { useEditDetails } from "./useEditMutations";

/**
 * Spec 18.0 AC53–AC54: the workout's title and notes, one sheet that commits once on Save details (like `NoteSheet`).
 * Only changed fields are sent; a client error blocks the request; a failure keeps the sheet open with the typed text.
 * Keyed per opening by the screen, so each opening starts from the cached detail.
 */
export function DetailsSheet({ open, workout, onClose, mode }: { open: boolean; workout: WorkoutDetail; onClose: () => void; mode: EditScreenMode }) {
  const save = useEditDetails();
  const [initial] = useState(() => initialForm(workout));
  const [form, setForm] = useState<DetailsForm>(initial);
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const inFlight = useRef(false);

  function change(field: DetailsField, value: string) {
    setForm((f) => ({ ...f, [field]: value }));
    setErrors((e) => ({ ...e, [field]: undefined }));
    setFormError(null);
  }

  /** The client check, field by field; also how a server `422` picks its copy (its message is never shown). */
  function check(fields: readonly DetailsField[]): Partial<Record<DetailsField, string>> {
    const found: Partial<Record<DetailsField, string>> = {};
    for (const field of fields) {
      const message = validate(field, form[field]);
      if (message !== null) found[field] = message;
    }
    return found;
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    const patch = buildPatch(initial, form);
    if (patch === null) {
      onClose(); // nothing changed: no request
      return;
    }
    const sent = Object.keys(patch) as DetailsField[];
    const clientErrors = check(sent);
    if (Object.keys(clientErrors).length > 0) {
      setErrors(clientErrors);
      return;
    }
    inFlight.current = true;
    setFormError(null);
    try {
      await save.mutateAsync({ workoutId: mode.workoutId, body: patch });
      onClose();
      mode.report({ type: "saved", announcement: EDIT_COPY.detailsSaved });
    } catch (error) {
      reportUnexpected("update-details", error);
      const failure = resolveEditFailure("update-details", error);
      if (failure.type === "vanished") {
        onClose();
        mode.report({ type: "vanished" });
      } else if (failure.type === "fields") {
        const rechecked = check(sent);
        if (Object.keys(rechecked).length > 0) setErrors(rechecked);
        else setFormError(failure.fallback);
      } else if (failure.type === "message") {
        setFormError(failure.text);
      } else {
        setFormError(EDIT_COPY.retry["update-details"]);
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    // DM-12: a save in flight keeps the sheet open, so its failure is shown where the lifter can see it.
    <Sheet open={open} title={EDIT_COPY.details.heading} onClose={onClose} dismissible={!save.isPending}>
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <Field id="workout-title" label={EDIT_COPY.details.title} hint={`${Array.from(form.title).length} / ${WORKOUT_TITLE_MAX}`} {...(errors.title ? { error: errors.title } : {})}>
          {(control) => <input {...control} type="text" className={styles.input} value={form.title} onChange={(e) => change("title", e.target.value)} />}
        </Field>
        <Field id="workout-notes" label={EDIT_COPY.details.notes} hint={`${Array.from(form.notes).length} / ${WORKOUT_NOTES_MAX}`} {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={6} value={form.notes} onChange={(e) => change("notes", e.target.value)} />}
        </Field>
        {formError ? (
          <p className={sheetStyles.formError} role="alert">
            {formError}
          </p>
        ) : null}
        <div className={styles.actions}>
          <Button type="submit" busy={save.isPending}>
            {EDIT_COPY.details.save}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
