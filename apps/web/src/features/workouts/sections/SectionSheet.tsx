import { useId, useMemo, useState, type FormEvent } from "react";
import type { WorkoutSection } from "@sin/core";
import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { Sheet } from "../../../ui/Sheet";
import { SheetActions } from "../../../ui/SheetActions";
import { useClearOnEdit } from "../../../ui/useClearOnEdit";
import { TimerFields } from "../../sectionTimer/TimerFieldGroup";
import { fieldsFromTimer, timerFromFields, type TimerFieldErrors } from "../../sectionTimer/timerFields";
import { SECTION_COPY } from "./sectionCopy";
import { checkSectionFields, type SectionValues } from "./sectionFields";
import styles from "./SectionSheet.module.css";

// One object for "no timer errors", so the clear-on-edit state isn't reset by a fresh `{}` every render (minor 326).
const NO_TIMER_ERRORS: TimerFieldErrors = Object.freeze({});
const NO_FIELD_ERRORS = Object.freeze({ name: null, notes: null });

interface OwnErrors {
  /** The server errors these were made against; once `errors` changes, the server's answer wins. */
  readonly against: SectionSheetErrors;
  readonly field: { readonly name: string | null; readonly notes: string | null };
  readonly timer: TimerFieldErrors;
}

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
  // The sheet's own checks (a timer that doesn't parse, Name and Note with it, a format change, or a Save that passes
  // them all) win over the server's errors they were made against; the server's next answer (a new `errors` object)
  // wins again. So a server message the lifter fixed never comes back on a Save that passes (code review #2), and a Save
  // the timer check stops still checks Name and Note (final review #2).
  const [own, setOwn] = useState<OwnErrors | null>(null);
  const current = own !== null && own.against === errors ? own : null;
  // Minor 326: a message shows from the Save (or the server's 422) that found it until the lifter edits that field.
  const fieldErrors = useMemo(() => current?.field ?? { name: errors.name, notes: errors.notes }, [current, errors]);
  const shown = useClearOnEdit(fieldErrors);
  const timerShown = useClearOnEdit(current?.timer ?? errors.timer ?? NO_TIMER_ERRORS);
  const editing = mode === "edit";
  const formId = useId();
  const removable = editing && onRemove !== undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = timerFromFields(timer);
    if (!parsed.ok) {
      setOwn({ against: errors, field: checkSectionFields(name, notes), timer: parsed.errors });
      return;
    }
    setOwn({ against: errors, field: NO_FIELD_ERRORS, timer: NO_TIMER_ERRORS });
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
        <Field id="section-name" label={SECTION_COPY.nameLabel} error={shown.of("name")}>
          {(control) => (
            <input
              {...control}
              type="text"
              autoComplete="off"
              required
              className={styles.input}
              value={name}
              onChange={(e) => {
                shown.edit("name");
                setName(e.target.value);
              }}
            />
          )}
        </Field>
        <Field id="section-notes" label={SECTION_COPY.noteLabel} hint={SECTION_COPY.noteHint} error={shown.of("notes")}>
          {(control) => (
            <textarea
              {...control}
              rows={3}
              className={styles.textarea}
              value={notes}
              onChange={(e) => {
                shown.edit("notes");
                setNotes(e.target.value);
              }}
            />
          )}
        </Field>
        <TimerFields
          idPrefix="section-timer"
          value={timer}
          errors={timerShown.visible}
          onEdit={(field) => timerShown.edit(field)}
          disabled={timerLocked !== undefined}
          onChange={(next) => {
            // Spec 10.7 AC4: another format starts clean — its fields are empty, and so are the old format's errors.
            if (next.format !== timer.format) setOwn({ against: errors, field: fieldErrors, timer: NO_TIMER_ERRORS });
            setTimer(next);
          }}
        />
        {timerLocked !== undefined ? <p className={styles.timerLocked}>{timerLocked}</p> : null}
      </form>
      {/* Minor 498: no line under the fields; Remove section's confirm says what happens to the exercises. */}
      <SheetActions
        error={errors.form}
        danger={
          removable ? (
            <Button variant="danger" disabled={busy} onClick={onRemove} ref={removeRef}>
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
