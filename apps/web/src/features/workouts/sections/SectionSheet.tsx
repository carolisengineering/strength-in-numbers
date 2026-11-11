import { useId, useState, type FormEvent } from "react";
import type { WorkoutSection } from "@sin/core";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Sheet } from "../../../ui/Sheet";
import { SheetActions } from "../../../ui/SheetActions";
import { TimerFields } from "../../sectionTimer/TimerFieldGroup";
import { fieldsFromTimer, timerFromFields, type TimerFieldErrors } from "../../sectionTimer/timerFields";
import { SECTION_COPY } from "./sectionCopy";
import type { SectionValues } from "./sectionFields";
import styles from "./SectionSheet.module.css";

export interface SectionSheetErrors {
  readonly name: string | null;
  readonly notes: string | null;
  readonly form: string | null;
  /** Spec 10.7 AC25: the server's timer field errors (absent = none). */
  readonly timer?: TimerFieldErrors | null;
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
  /** Spec 10.7 AC16: the Save / Add section button, so Cancel on the timer confirm can return focus to it. */
  saveRef?: (node: HTMLButtonElement | null) => void;
  /**
   * Spec 10.7 AC40: the section has unsent timer entries, so its Timer group can't change (name and note can). The
   * line to show under it, from the caller (`sections/` doesn't import `result/`); absent = not locked.
   */
  timerLocked?: string;
}

/**
 * Spec 10.6 AC5, AC7, AC8, 10.7 AC15 — New section / Edit section. The text and the Timer group are component
 * state, seeded once from the section; the owner remounts it per opening (`key`), so it starts fresh each time
 * and is never stored. No field is autofocused (the `Sheet` rule: no phone keyboard on open). Submit parses the
 * timer here: a field that doesn't parse shows its error and nothing is submitted.
 */
export function SectionSheet({ open, mode, section, busy, errors, onSubmit, onClose, onRemove, removeRef, saveRef, timerLocked }: SectionSheetProps) {
  const [name, setName] = useState(() => section?.name ?? "");
  const [notes, setNotes] = useState(() => section?.notes ?? "");
  const [timer, setTimer] = useState(() => fieldsFromTimer(section?.timer ?? null));
  // The sheet's own timer errors (a parse on submit, or `{}` after a format change) win over the server's.
  const [ownTimerErrors, setOwnTimerErrors] = useState<TimerFieldErrors | null>(null);
  const editing = mode === "edit";
  const formId = useId();
  const lineId = useId();
  const removable = editing && onRemove !== undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = timerFromFields(timer);
    if (!parsed.ok) {
      setOwnTimerErrors(parsed.errors);
      return;
    }
    setOwnTimerErrors(null);
    onSubmit({ name, notes, timer: parsed.timer });
  }

  return (
    <Sheet
      open={open}
      title={editing ? SECTION_COPY.editTitle : SECTION_COPY.newTitle}
      onClose={onClose}
      dismissible={!busy}
      dismissLabel={SECTION_COPY.cancel}
    >
      <form id={formId} className={styles.form} noValidate onSubmit={submit}>
        {editing ? null : <p className={styles.intro}>{SECTION_COPY.newIntro}</p>}
        <Field id="section-name" label={SECTION_COPY.nameLabel} {...(errors.name ? { error: errors.name } : {})}>
          {(control) => (
            <input {...control} type="text" autoComplete="off" required className={styles.input} value={name} onChange={(e) => setName(e.target.value)} />
          )}
        </Field>
        <Field id="section-notes" label={SECTION_COPY.noteLabel} hint={SECTION_COPY.noteHint} {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} rows={3} className={styles.textarea} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <TimerFields
          idPrefix="section-timer"
          value={timer}
          errors={ownTimerErrors ?? errors.timer ?? {}}
          disabled={timerLocked !== undefined}
          onChange={(next) => {
            // Spec 10.7 AC4: another format starts clean — its fields are empty, and so are the old format's errors.
            if (next.format !== timer.format) setOwnTimerErrors({});
            setTimer(next);
          }}
        />
        {timerLocked !== undefined ? <p className={styles.timerLocked}>{timerLocked}</p> : null}
      </form>
      {/* Spec 17.10: the line stays in the body, last, and describes the row's Remove section; in the status line it
          would sit above Save on every edit. */}
      {removable ? (
        <div className={styles.remove} data-divider="">
          <p id={lineId} className={styles.removeLine}>
            {SECTION_COPY.removeLine}
          </p>
        </div>
      ) : null}
      <SheetActions
        notice={errors.form ? <InlineNotice tone="error">{errors.form}</InlineNotice> : null}
        danger={
          removable ? (
            <Button variant="danger" disabled={busy} onClick={onRemove} ref={removeRef} aria-describedby={lineId}>
              {SECTION_COPY.removeSection}
            </Button>
          ) : undefined
        }
        primary={
          <Button type="submit" form={formId} busy={busy} ref={saveRef}>
            {editing ? SECTION_COPY.save : SECTION_COPY.addSection}
          </Button>
        }
      />
    </Sheet>
  );
}
