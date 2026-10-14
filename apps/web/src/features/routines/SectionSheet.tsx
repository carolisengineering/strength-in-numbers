import { useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import type { DraftSection } from "./routineDraft";
import { parseSectionName, parseSectionNotes } from "./sectionText";
import styles from "./Sections.module.css";

export interface SectionSheetProps {
  open: boolean;
  section: DraftSection;
  /** Validation / server messages for this section, shown beside the fields when the sheet opens (AC22). */
  messages?: { name?: string; notes?: string };
  onDone: (name: string, notes: string) => void;
  onClose: () => void;
}

/** One section's name and note (Spec 10.3 AC16). Local state; Done parses and commits, Close discards. The editor keys it per opening. */
export function SectionSheet({ open, section, messages = {}, onDone, onClose }: SectionSheetProps) {
  const [name, setName] = useState(section.name);
  const [notes, setNotes] = useState(section.notes);
  const [errors, setErrors] = useState<{ name?: string; notes?: string }>(messages);

  function done() {
    const nameParsed = parseSectionName(name);
    const notesParsed = parseSectionNotes(notes);
    const next: { name?: string; notes?: string } = {};
    if (!nameParsed.ok) next.name = nameParsed.message;
    if (!notesParsed.ok) next.notes = notesParsed.message;
    setErrors(next);
    if (!nameParsed.ok || !notesParsed.ok) return;
    onDone(nameParsed.value, notesParsed.value);
  }

  return (
    <Sheet open={open} title="Edit section" onClose={onClose}>
      <form
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
        <Button type="submit" block>
          Done
        </Button>
      </form>
    </Sheet>
  );
}
