import { useState } from "react";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import type { DraftItem } from "./routineDraft";
import styles from "./ItemSheet.module.css";
import {
  formatReps,
  formatRest,
  parseNotes,
  parseReps,
  parseRest,
  parseSets,
  RPE_CHOICES,
  type Targets,
} from "./targetFormat";

export interface ItemSheetProps {
  open: boolean;
  title: string;
  item: DraftItem;
  onDone: (targets: Targets, notes: string | null) => void;
  onClose: () => void;
}

type FieldName = "sets" | "reps" | "rest" | "notes";

/**
 * One item's targets (Spec 10.0 AC28, D4, D18). Sheet-local strings: nothing reaches the draft until
 * Done parses every field; Close discards. The editor keys this component per opening, so the fields
 * always start from the stored values.
 */
export function ItemSheet({ open, title, item, onDone, onClose }: ItemSheetProps) {
  const [sets, setSets] = useState(item.targetSets === null ? "" : String(item.targetSets));
  const [reps, setReps] = useState(formatReps(item.targetRepsLow, item.targetRepsHigh));
  const [rpe, setRpe] = useState(item.targetRpe === null ? "" : String(item.targetRpe));
  const [rest, setRest] = useState(item.restSeconds === null ? "" : formatRest(item.restSeconds));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [errors, setErrors] = useState<Partial<Record<FieldName, string>>>({});

  function done() {
    const parsed = { sets: parseSets(sets), reps: parseReps(reps), rest: parseRest(rest), notes: parseNotes(notes) };
    const next: Partial<Record<FieldName, string>> = {};
    for (const [name, result] of Object.entries(parsed) as [FieldName, (typeof parsed)[FieldName]][]) {
      if (!result.ok) next[name] = result.message;
    }
    setErrors(next);
    if (!parsed.sets.ok || !parsed.reps.ok || !parsed.rest.ok || !parsed.notes.ok) return;
    onDone(
      {
        targetSets: parsed.sets.value,
        targetRepsLow: parsed.reps.value.low,
        targetRepsHigh: parsed.reps.value.high,
        targetRpe: rpe === "" ? null : Number(rpe),
        restSeconds: parsed.rest.value,
      },
      parsed.notes.value,
    );
  }

  return (
    <Sheet open={open} title={title} onClose={onClose}>
      <form
        className={styles.form}
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          done();
        }}
      >
        <Field id="item-sets" label="Sets" {...(errors.sets ? { error: errors.sets } : {})}>
          {(control) => <input {...control} className={styles.input} inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} />}
        </Field>
        <Field id="item-reps" label="Reps" hint="8 or 8-10" {...(errors.reps ? { error: errors.reps } : {})}>
          {(control) => <input {...control} className={styles.input} inputMode="text" value={reps} onChange={(e) => setReps(e.target.value)} />}
        </Field>
        <Field id="item-rpe" label="RPE">
          {(control) => (
            <select {...control} className={styles.input} value={rpe} onChange={(e) => setRpe(e.target.value)}>
              <option value="">No target</option>
              {RPE_CHOICES.map((value) => (
                <option key={value} value={String(value)}>
                  {value}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field id="item-rest" label="Rest" hint="m:ss, like 1:30" {...(errors.rest ? { error: errors.rest } : {})}>
          {(control) => <input {...control} className={styles.input} inputMode="text" value={rest} onChange={(e) => setRest(e.target.value)} />}
        </Field>
        <Field id="item-notes" label="Notes" {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <Button type="submit" block>
          Done
        </Button>
      </form>
    </Sheet>
  );
}
