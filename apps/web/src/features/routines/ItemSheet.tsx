import { useState } from "react";
import { deriveTargets, forbiddenMeasuresFor, type Modality, type WeightUnit } from "@sin/core";
import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Sheet } from "../../ui/Sheet";
import {
  addRow,
  enterPlan,
  moveRow,
  parseRows,
  quickFromRows,
  removeRow,
  rowsFromPlan,
  setRowField,
  setUnit,
  unitOfRows,
  type PlanRowText,
  type RowErrors,
} from "./planRows";
import { PlanRowList } from "./PlanRowList";
import type { DraftItem, PlannedEdit } from "./routineDraft";
import type { SheetMessages } from "./sheetIssues";
import styles from "./ItemSheet.module.css";
import {
  formatReps,
  formatRest,
  formatWeight,
  parseNotes,
  parseReps,
  parseRest,
  parseSets,
  parseWeight,
  type Targets,
} from "./targetFormat";
import { UnitToggle } from "./UnitToggle";
import { WEIGHT_NEEDS_SETS } from "./validateDraft";

export interface ItemSheetProps {
  open: boolean;
  title: string;
  item: DraftItem;
  /** The exercise's modality; `null` (the catalog has not synced) shows every field (AC11). */
  modality?: Modality | null;
  /** The profile's unit: the toggle's default when the item has no stored unit (AC10). */
  defaultUnit?: WeightUnit;
  /** Server / validation messages for this item, shown beside the fields when the sheet opens (AC16). */
  fieldMessages?: SheetMessages;
  rowMessages?: ReadonlyMap<string, RowErrors>;
  /** Called with the weight / plan result just before `onDone`; the editor always passes it. */
  onPlanned?: (planned: PlannedEdit) => void;
  onDone: (targets: Targets, notes: string | null) => void;
  onClose: () => void;
}

const NO_MESSAGES: SheetMessages = {};
const NO_ROW_MESSAGES: ReadonlyMap<string, RowErrors> = new Map();

/**
 * One item's targets (Spec 10.0 AC28, D4, D18; Spec 10.2 AC10–AC16). Sheet-local state: nothing reaches the
 * draft until Done parses every field and row; Close discards — entering plan mode included. The editor keys
 * this component per opening, so the fields always start from the stored values.
 */
export function ItemSheet({
  open,
  title,
  item,
  modality = null,
  defaultUnit = "kg",
  fieldMessages = NO_MESSAGES,
  rowMessages = NO_ROW_MESSAGES,
  onPlanned,
  onDone,
  onClose,
}: ItemSheetProps) {
  const forbidden = modality === null ? [] : forbiddenMeasuresFor(modality);
  const showReps = !forbidden.includes("reps");
  const showWeight = !forbidden.includes("weight");

  // Fields the exercise cannot carry start blank (AC18): a stored value is cleaned by a deliberate Done, never shown.
  const [sets, setSets] = useState(item.targetSets === null ? "" : String(item.targetSets));
  const [reps, setReps] = useState(showReps ? formatReps(item.targetRepsLow, item.targetRepsHigh) : "");
  const [weight, setWeight] = useState(showWeight && item.weight !== null ? formatWeight(item.weight) : "");
  const [unit, setQuickUnit] = useState<WeightUnit>(item.weightUnit ?? defaultUnit);
  const [plan, setPlan] = useState<readonly PlanRowText[] | null>(() =>
    item.plan === null ? null : rowsFromPlan(item.plan).map((r) => ({ ...r, reps: showReps ? r.reps : "", weight: showWeight ? r.weight : "" })),
  );
  const [rest, setRest] = useState(item.restSeconds === null ? "" : formatRest(item.restSeconds));
  const [notes, setNotes] = useState(item.notes ?? "");
  const [errors, setErrors] = useState<SheetMessages>(fieldMessages);
  const [rowErrors, setRowErrors] = useState<ReadonlyMap<string, RowErrors>>(rowMessages);

  const planUnit: WeightUnit | "mixed" = plan === null ? unit : (unitOfRows(plan) ?? unit);
  // A weight typed into a row that has no unit takes the unit the toggle shows (never silently the profile's).
  const rowFallbackUnit: WeightUnit = planUnit === "mixed" ? unit : planUnit;
  const quickLine = plan === null ? null : quickFromRows(plan, rowFallbackUnit);

  function enter() {
    const parsed = parseSets(sets);
    if (!parsed.ok) {
      setErrors((previous) => ({ ...previous, sets: parsed.message }));
      return;
    }
    setErrors({});
    setPlan(enterPlan({ count: parsed.value, reps, weight, weightUnit: unit }, () => crypto.randomUUID()));
  }

  function back() {
    if (plan === null || quickLine === null) return;
    setSets(quickLine.sets);
    setReps(quickLine.reps);
    setWeight(quickLine.weight);
    if (quickLine.weightUnit !== null) setQuickUnit(quickLine.weightUnit);
    setRowErrors(new Map());
    setPlan(null);
  }

  function edit(change: (rows: readonly PlanRowText[]) => readonly PlanRowText[]) {
    setPlan((rows) => (rows === null ? rows : change(rows)));
  }

  function done() {
    const restParsed = parseRest(rest);
    const notesParsed = parseNotes(notes);
    const next: SheetMessages = {};
    if (!restParsed.ok) next.rest = restParsed.message;
    if (!notesParsed.ok) next.notes = notesParsed.message;

    if (plan !== null) {
      const parsedRows = parseRows(plan, rowFallbackUnit);
      setErrors(next);
      setRowErrors(parsedRows.ok ? new Map() : parsedRows.errors);
      if (!parsedRows.ok || !restParsed.ok || !notesParsed.ok) return;
      onPlanned?.({ mode: "rows", rows: parsedRows.rows });
      // targetRpe is not shown (Spec 17.1 Phase A); pass the stored value through so Done never clears it.
      onDone({ ...deriveTargets(parsedRows.rows), targetRpe: item.targetRpe, restSeconds: restParsed.value }, notesParsed.value);
      return;
    }

    const setsParsed = parseSets(sets);
    const repsParsed = parseReps(reps);
    const weightParsed = parseWeight(weight);
    if (!setsParsed.ok) next.sets = setsParsed.message;
    if (!repsParsed.ok) next.reps = repsParsed.message;
    if (!weightParsed.ok) next.weight = weightParsed.message;
    else if (showWeight && weightParsed.value !== null && setsParsed.ok && setsParsed.value === null) next.weight = WEIGHT_NEEDS_SETS;
    setErrors(next);
    if (!setsParsed.ok || !repsParsed.ok || !weightParsed.ok || !restParsed.ok || !notesParsed.ok || next.weight !== undefined) return;
    const planned = showWeight ? weightParsed.value : null;
    onPlanned?.({ mode: "quick", weight: planned, weightUnit: planned === null ? null : unit });
    onDone(
      {
        targetSets: setsParsed.value,
        targetRepsLow: repsParsed.value.low,
        targetRepsHigh: repsParsed.value.high,
        targetRpe: item.targetRpe,
        restSeconds: restParsed.value,
      },
      notesParsed.value,
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
        {plan === null ? (
          <>
            <Field id="item-sets" label="Sets" {...(errors.sets ? { error: errors.sets } : {})}>
              {(control) => <input {...control} className={styles.input} inputMode="numeric" value={sets} onChange={(e) => setSets(e.target.value)} />}
            </Field>
            {showReps ? (
              <Field id="item-reps" label="Reps" hint="8 or 8-10" {...(errors.reps ? { error: errors.reps } : {})}>
                {(control) => <input {...control} className={styles.input} inputMode="text" value={reps} onChange={(e) => setReps(e.target.value)} />}
              </Field>
            ) : null}
            {showWeight ? (
              <div className={styles.weight}>
                <Field id="item-weight" label="Weight" {...(errors.weight ? { error: errors.weight } : {})}>
                  {(control) => <input {...control} className={styles.input} inputMode="decimal" autoComplete="off" value={weight} onChange={(e) => setWeight(e.target.value)} />}
                </Field>
                <UnitToggle label="Weight unit" value={unit} onChange={setQuickUnit} />
              </div>
            ) : null}
          </>
        ) : (
          <>
            <PlanRowList
              rows={plan}
              showReps={showReps}
              showWeight={showWeight}
              unit={planUnit}
              errors={rowErrors}
              onField={(key, patch) => edit((rows) => setRowField(rows, key, patch))}
              onAdd={() => edit((rows) => addRow(rows, crypto.randomUUID()))}
              onRemove={(key) => edit((rows) => removeRow(rows, key))}
              onMove={(key, dir) => edit((rows) => moveRow(rows, key, dir))}
              onUnit={(next) => {
                setQuickUnit(next);
                edit((rows) => setUnit(rows, next));
              }}
            />
            {quickLine !== null ? (
              <Button variant="secondary" onClick={back}>
                Back to the quick line
              </Button>
            ) : (
              <p className={styles.note}>Sets differ, so they can't be shown as one line</p>
            )}
          </>
        )}
        <Field id="item-rest" label="Rest" hint="m:ss, like 1:30" {...(errors.rest ? { error: errors.rest } : {})}>
          {(control) => <input {...control} className={styles.input} inputMode="text" value={rest} onChange={(e) => setRest(e.target.value)} />}
        </Field>
        <Field id="item-notes" label="Notes" {...(errors.notes ? { error: errors.notes } : {})}>
          {(control) => <textarea {...control} className={styles.input} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {plan === null ? (
          <Button variant="secondary" onClick={enter}>
            Plan each set
          </Button>
        ) : null}
        <Button type="submit" block>
          Done
        </Button>
      </form>
    </Sheet>
  );
}
