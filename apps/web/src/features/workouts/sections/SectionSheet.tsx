import { useState, type FormEvent } from "react";
import type { WorkoutSection } from "@sin/core";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Sheet } from "../../../ui/Sheet";
import { SECTION_COPY } from "./sectionCopy";
import type { SectionValues } from "./sectionFields";
import styles from "./SectionSheet.module.css";

export interface SectionSheetErrors {
  readonly name: string | null;
  readonly notes: string | null;
  readonly form: string | null;
}

export interface SectionSheetProps {
  open: boolean;
  mode: "add" | "edit";
  /** The section being edited (edit mode). */
  section?: WorkoutSection;
  busy: boolean;
  errors: SectionSheetErrors;
  onSubmit(values: SectionValues): void;
  onClose(): void;
  onRemove?(): void;
  removeRef?: (node: HTMLButtonElement | null) => void;
}

/**
 * Spec 10.6 AC5, AC7, AC8 — New section / Edit section. The text is component state, seeded once from
 * the section; the owner remounts it per opening (`key`), so it starts fresh each time and is never
 * stored. No field is autofocused (the `Sheet` rule: no phone keyboard on open).
 */
export function SectionSheet({ open, mode, section, busy, errors, onSubmit, onClose, onRemove, removeRef }: SectionSheetProps) {
  const [name, setName] = useState(() => section?.name ?? "");
  const [notes, setNotes] = useState(() => section?.notes ?? "");
  const editing = mode === "edit";

  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit({ name, notes });
  }

  return (
    <Sheet open={open} title={editing ? SECTION_COPY.editTitle : SECTION_COPY.newTitle} onClose={onClose} dismissible={!busy}>
      <form className={styles.form} noValidate onSubmit={submit}>
        {editing ? null : <p className={styles.intro}>{SECTION_COPY.newIntro}</p>}
        <Field id="section-name" label={SECTION_COPY.nameLabel} {...(errors.name ? { error: errors.name } : {})}>
          {(control) => (
            <input {...control} type="text" autoComplete="off" required className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field id="section-notes" label={SECTION_COPY.noteLabel} hint={SECTION_COPY.noteHint} {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} rows={3} className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {errors.form ? <InlineNotice tone="error">{errors.form}</InlineNotice> : null}
        <div className={styles.actions}>
          <Button variant="secondary" disabled={busy} onClick={onClose}>
            {SECTION_COPY.cancel}
          </Button>
          <Button type="submit" busy={busy}>
            {editing ? SECTION_COPY.save : SECTION_COPY.addSection}
          </Button>
        </div>
      </form>
      {editing && onRemove ? (
        <div className={styles.remove} data-divider="">
          <Button variant="danger" disabled={busy} onClick={onRemove} ref={removeRef}>
            {SECTION_COPY.removeSection}
          </Button>
          <p className={styles.removeLine}>{SECTION_COPY.removeLine}</p>
        </div>
      ) : null}
    </Sheet>
  );
}
