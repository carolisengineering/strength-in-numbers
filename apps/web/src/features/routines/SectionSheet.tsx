import type { SectionTimer } from "@sin/core";
import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import { SheetActions } from "../../ui/SheetActions";
import { TimerFields } from "../sectionTimer/TimerFieldGroup";
import { fieldsFromTimer, timerFromFields, type TimerFieldErrors } from "../sectionTimer/timerFields";
import type { DraftSection } from "./routineDraft";
import type { SectionMessages } from "./sheetIssues";
import { parseSectionName, parseSectionNotes } from "./sectionText";
import styles from "./Sections.module.css";

export interface SectionSheetProps {
  open: boolean;
  section: DraftSection;
  /** Validation / server messages for this section, shown beside the fields when the sheet opens (AC22). */
  messages?: SectionMessages;
  onDone: (name: string, notes: string, timer: SectionTimer | null) => void;
  onClose: () => void;
}

/**
 * One section's name, note and timer (Spec 10.3 AC16, Spec 10.7 AC9). Local state; Done parses all three and commits
 * only when all are valid, Close discards. The editor keys it per opening.
 */
export function SectionSheet({ open, section, messages = {}, onDone, onClose }: SectionSheetProps) {
  const [name, setName] = useState(section.name);
  const [notes, setNotes] = useState(section.notes);
  const [errors, setErrors] = useState<{ name?: string; notes?: string }>({ name: messages.name, notes: messages.notes });
  const [timer, setTimer] = useState(() => fieldsFromTimer(section.timer));
  const [timerErrors, setTimerErrors] = useState<TimerFieldErrors>(messages.timer ?? {});
  const formId = useId();

  function done() {
    const nameParsed = parseSectionName(name);
    const notesParsed = parseSectionNotes(notes);
    const next: { name?: string; notes?: string } = {};
    if (!nameParsed.ok) next.name = nameParsed.message;
    if (!notesParsed.ok) next.notes = notesParsed.message;
    const timerParsed = timerFromFields(timer);
    setErrors(next);
    setTimerErrors(timerParsed.ok ? {} : timerParsed.errors);
    if (!nameParsed.ok || !notesParsed.ok || !timerParsed.ok) return;
    onDone(nameParsed.value, notesParsed.value, timerParsed.timer);
  }

  return (
    <Sheet open={open} title="Edit section" onClose={onClose}>
      <form
        id={formId}
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          done();
        }}
      >
        <Field id="section-name" label="Name" {...(errors.name ? { error: errors.name } : {})}>
          {(control) => <input {...control} className={styles.input} autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field id="section-notes" label="Note" hint="Optional" {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <TimerFields
          idPrefix="section-timer"
          value={timer}
          errors={timerErrors}
          onChange={(next) => {
            // Spec 10.7 AC4: another format starts clean — its fields are empty, and so are the old format's errors.
            if (next.format !== timer.format) setTimerErrors({});
            setTimer(next);
          }}
        />
      </form>
      <SheetActions
        primary={
          <Button type="submit" form={formId}>
            Done
          </Button>
        }
      />
    </Sheet>
  );
}
