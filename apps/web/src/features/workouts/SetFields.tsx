import { SET_TYPE_VALUES, type Modality } from "@sin/core";

import { Field } from "../../ui/Field";
import { SET_TYPE_LABELS } from "./format";
import { visibleMeasures } from "./measures";
import type { DraftField, SetDraft } from "./setDraft";
import styles from "./SetFields.module.css";

export type DraftEditField = keyof Omit<SetDraft, "attemptKey">;

export interface SetFieldsProps {
  modality: Modality;
  draft: SetDraft;
  errors: Partial<Record<DraftField, string>>;
  onChange: (field: DraftEditField, value: string) => void;
  /** Makes each control's id unique on a screen with many cards. */
  idPrefix: string;
}

const WEIGHT_UNITS = ["kg", "lb"] as const;
const DISTANCE_UNITS = ["m", "km", "mi"] as const;

/**
 * The modality-driven inputs, shared by the entry row and the edit sheet (Spec 06.1 §5.4, D8). The
 * visible measures are exactly the modality's required ones (`visibleMeasures`), so the UI cannot
 * construct a body the server's forbidden-measure rule would reject. Numeric fields are text inputs
 * with `inputMode` — never `type="number"` (§6.4): no locale decimal-separator surprises, no scroll
 * wheel, and "empty" is distinguishable from "invalid".
 */
export function SetFields({ modality, draft, errors, onChange, idPrefix }: SetFieldsProps) {
  const measures = visibleMeasures(modality);
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className={styles.fields}>
      <Field
        id={id("type")}
        label="Set type"
        hint={draft.setType === "failure" ? "Couldn't complete a rep? Log 0 reps." : undefined}
      >
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

      <div className={styles.measures}>
        {measures.map((measure) => {
          switch (measure) {
            case "distance":
              return (
                <div className={styles.withUnit} key={measure}>
                  <Field id={id("distance")} label="Distance" error={errors.distance}>
                    {(control) => (
                      <input
                        {...control}
                        className={styles.input}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={draft.distance}
                        onChange={(e) => onChange("distance", e.target.value)}
                      />
                    )}
                  </Field>
                  <select
                    className={styles.unit}
                    aria-label="Distance unit"
                    value={draft.distanceUnit}
                    onChange={(e) => onChange("distanceUnit", e.target.value)}
                  >
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
                  <Field
                    id={id("weight")}
                    label={modality === "weighted_bodyweight" ? "Added weight" : "Weight"}
                    error={errors.weight}
                  >
                    {(control) => (
                      <input
                        {...control}
                        className={styles.input}
                        type="text"
                        inputMode="decimal"
                        autoComplete="off"
                        value={draft.weight}
                        onChange={(e) => onChange("weight", e.target.value)}
                      />
                    )}
                  </Field>
                  <select
                    className={styles.unit}
                    aria-label="Weight unit"
                    value={draft.weightUnit}
                    onChange={(e) => onChange("weightUnit", e.target.value)}
                  >
                    {WEIGHT_UNITS.map((unit) => (
                      <option key={unit} value={unit}>
                        {unit}
                      </option>
                    ))}
                  </select>
                </div>
              );
            case "reps":
              return (
                <Field id={id("reps")} label="Reps" error={errors.reps} key={measure}>
                  {(control) => (
                    <input
                      {...control}
                      className={styles.input}
                      type="text"
                      inputMode="numeric"
                      autoComplete="off"
                      value={draft.reps}
                      onChange={(e) => onChange("reps", e.target.value)}
                    />
                  )}
                </Field>
              );
            case "durationS":
              // Two numeric fields, not "m:ss": a phone's numeric keypad has no colon (D10).
              return (
                <div className={styles.duration} key={measure}>
                  <Field id={id("minutes")} label="Minutes" error={errors.minutes}>
                    {(control) => (
                      <input
                        {...control}
                        className={styles.input}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={draft.minutes}
                        onChange={(e) => onChange("minutes", e.target.value)}
                      />
                    )}
                  </Field>
                  <Field id={id("seconds")} label="Seconds" error={errors.seconds}>
                    {(control) => (
                      <input
                        {...control}
                        className={styles.input}
                        type="text"
                        inputMode="numeric"
                        autoComplete="off"
                        value={draft.seconds}
                        onChange={(e) => onChange("seconds", e.target.value)}
                      />
                    )}
                  </Field>
                </div>
              );
          }
        })}
      </div>

      <details className={styles.more}>
        <summary className={styles.summary}>More</summary>
        <Field id={id("rpe")} label="RPE" error={errors.rpe}>
          {(control) => (
            <input
              {...control}
              className={styles.input}
              type="text"
              inputMode="decimal"
              autoComplete="off"
              value={draft.rpe}
              onChange={(e) => onChange("rpe", e.target.value)}
            />
          )}
        </Field>
      </details>
    </div>
  );
}
