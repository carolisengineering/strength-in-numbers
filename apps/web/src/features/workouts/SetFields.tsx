import { useState } from "react";
import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, type Modality } from "@sin/core";

import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { SET_TYPE_LABELS } from "./format";
import { visibleMeasures } from "./measures";
import type { DraftField, SetDraft } from "./setDraft";
import { NumberStepper } from "./NumberStepper";
import { WEIGHT_STEP, repsAtLimit, stepReps, stepWeight, weightAtLimit } from "./stepper";
import styles from "./SetFields.module.css";

export type DraftEditField = keyof Omit<SetDraft, "attemptKey">;

export interface SetFieldsProps {
  modality: Modality;
  draft: SetDraft;
  errors: Partial<Record<DraftField, string>>;
  onChange: (field: DraftEditField, value: string) => void;
  /** Makes each control's id unique on a screen with many cards. */
  idPrefix: string;
  /** `entry`: the current-set panel (steppers, "Set options", Spec 17.1). `sheet`: the edit sheet's layout, unchanged. */
  variant?: "sheet" | "entry";
}

const WEIGHT_UNITS = ["kg", "lb"] as const;
const DISTANCE_UNITS = DISTANCE_UNIT_VALUES; // Spec 05.3 D20: ft joins m, km, mi

type Common = Omit<SetFieldsProps, "variant"> & { id: (name: string) => string };

function SetTypeField({ draft, onChange, id }: Common) {
  return (
    <Field id={id("type")} label="Set type" hint={draft.setType === "failure" ? "Couldn't complete a rep? Log 0 reps." : undefined}>
      {(control) => (
        <select {...control} className={styles.select} value={draft.setType} onChange={(e) => onChange("setType", e.target.value)}>
          {SET_TYPE_VALUES.map((type) => (
            <option key={type} value={type}>
              {SET_TYPE_LABELS[type]}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function TextField({ name, label, inputMode, value, error, onChange, id, className }: { name: string; label: string; inputMode: "decimal" | "numeric"; value: string; error?: string | undefined; onChange: (v: string) => void; id: (n: string) => string; className: string | undefined }) {
  return (
    <Field id={id(name)} label={label} error={error}>
      {(control) => (
        <input {...control} className={className} type="text" inputMode={inputMode} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </Field>
  );
}

/**
 * The modality-driven inputs, shared by the entry panel and the edit sheet (Spec 06.1 §5.4, D8). The visible measures
 * are exactly the modality's required ones (`visibleMeasures`), so the UI cannot construct a body the server's
 * forbidden-measure rule would reject. Numeric fields are text inputs with `inputMode`, never `type="number"`.
 * Spec 17.1 Phase A: RPE is not shown; the draft still carries it, so an edit never clears a stored value.
 */
export function SetFields({ variant = "sheet", ...props }: SetFieldsProps) {
  const id = (name: string) => `${props.idPrefix}-${name}`;
  return variant === "entry" ? <EntryFields {...props} id={id} /> : <SheetFields {...props} id={id} />;
}

function SheetFields(props: Common) {
  const { modality, draft, errors, onChange, id } = props;
  return (
    <div className={styles.fields}>
      <SetTypeField {...props} />
      <div className={styles.measures}>
        {visibleMeasures(modality).map((measure) => {
          switch (measure) {
            case "distance":
              return (
                <div className={styles.withUnit} key={measure}>
                  <TextField name="distance" label="Distance" inputMode="decimal" value={draft.distance} error={errors.distance} onChange={(v) => onChange("distance", v)} id={id} className={styles.input} />
                  <select className={styles.unit} aria-label="Distance unit" value={draft.distanceUnit} onChange={(e) => onChange("distanceUnit", e.target.value)}>
                    {DISTANCE_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              );
            case "weight":
              return (
                <div className={styles.withUnit} key={measure}>
                  <TextField name="weight" label={modality === "weighted_bodyweight" ? "Added weight" : "Weight"} inputMode="decimal" value={draft.weight} error={errors.weight} onChange={(v) => onChange("weight", v)} id={id} className={styles.input} />
                  <select className={styles.unit} aria-label="Weight unit" value={draft.weightUnit} onChange={(e) => onChange("weightUnit", e.target.value)}>
                    {WEIGHT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              );
            case "reps":
              return <TextField key={measure} name="reps" label="Reps" inputMode="numeric" value={draft.reps} error={errors.reps} onChange={(v) => onChange("reps", v)} id={id} className={styles.input} />;
            case "durationS":
              // Two numeric fields, not "m:ss": a phone's numeric keypad has no colon (D10).
              return (
                <div className={styles.duration} key={measure}>
                  <TextField name="minutes" label="Minutes" inputMode="numeric" value={draft.minutes} error={errors.minutes} onChange={(v) => onChange("minutes", v)} id={id} className={styles.input} />
                  <TextField name="seconds" label="Seconds" inputMode="numeric" value={draft.seconds} error={errors.seconds} onChange={(v) => onChange("seconds", v)} id={id} className={styles.input} />
                </div>
              );
          }
        })}
      </div>
    </div>
  );
}

/** Spec 17.1 §6.4–§6.5: steppers for weight and reps, figure-sized fields for duration and distance, and "Set options". */
function EntryFields(props: Common) {
  const { modality, draft, errors, onChange, id } = props;
  const [optionsOpen, setOptionsOpen] = useState(false);
  const measures = visibleMeasures(modality);
  const step = `${WEIGHT_STEP[draft.weightUnit]} ${draft.weightUnit}`;
  const figure = `${styles.input} ${styles.figureInput}`;
  return (
    <div className={styles.fields}>
      <div className={`${styles.measures} ${styles.entryMeasures}`}>
        {measures.map((measure) => {
          switch (measure) {
            case "weight":
              return (
                <NumberStepper
                  key={measure}
                  id={id("weight")}
                  label={modality === "weighted_bodyweight" ? "Added weight" : "Weight"}
                  unit={draft.weightUnit}
                  value={draft.weight}
                  inputMode="decimal"
                  error={errors.weight}
                  decreaseLabel={`Decrease weight by ${step}`}
                  increaseLabel={`Increase weight by ${step}`}
                  canDecrease={!weightAtLimit(draft.weight, "down")}
                  canIncrease={!weightAtLimit(draft.weight, "up")}
                  onChange={(v) => onChange("weight", v)}
                  onDecrease={() => onChange("weight", stepWeight(draft.weight, draft.weightUnit, "down"))}
                  onIncrease={() => onChange("weight", stepWeight(draft.weight, draft.weightUnit, "up"))}
                />
              );
            case "reps":
              return (
                <NumberStepper
                  key={measure}
                  id={id("reps")}
                  label="Reps"
                  value={draft.reps}
                  inputMode="numeric"
                  error={errors.reps}
                  decreaseLabel="Decrease reps"
                  increaseLabel="Increase reps"
                  canDecrease={!repsAtLimit(draft.reps, "down")}
                  canIncrease={!repsAtLimit(draft.reps, "up")}
                  onChange={(v) => onChange("reps", v)}
                  onDecrease={() => onChange("reps", stepReps(draft.reps, "down"))}
                  onIncrease={() => onChange("reps", stepReps(draft.reps, "up"))}
                />
              );
            case "distance":
              return <TextField key={measure} name="distance" label="Distance" inputMode="decimal" value={draft.distance} error={errors.distance} onChange={(v) => onChange("distance", v)} id={id} className={figure} />;
            case "durationS":
              return (
                <div className={styles.duration} key={measure}>
                  <TextField name="minutes" label="Minutes" inputMode="numeric" value={draft.minutes} error={errors.minutes} onChange={(v) => onChange("minutes", v)} id={id} className={figure} />
                  <TextField name="seconds" label="Seconds" inputMode="numeric" value={draft.seconds} error={errors.seconds} onChange={(v) => onChange("seconds", v)} id={id} className={figure} />
                </div>
              );
          }
        })}
      </div>
      <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
        Set options
      </Button>
      {optionsOpen ? (
        <div className={styles.options}>
          <SetTypeField {...props} />
          {measures.includes("weight") ? (
            <Field id={id("weight-unit")} label="Weight unit">
              {(control) => (
                <select {...control} className={styles.select} value={draft.weightUnit} onChange={(e) => onChange("weightUnit", e.target.value)}>
                  {WEIGHT_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
          {measures.includes("distance") ? (
            <Field id={id("distance-unit")} label="Distance unit">
              {(control) => (
                <select {...control} className={styles.select} value={draft.distanceUnit} onChange={(e) => onChange("distanceUnit", e.target.value)}>
                  {DISTANCE_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
