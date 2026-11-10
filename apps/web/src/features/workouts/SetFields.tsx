import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, type MeasureName, type Modality } from "@sin/core";

import { Button } from "../../ui/Button";
import { Field } from "../../ui/Field";
import { Segmented } from "../../ui/Segmented";
import { SET_TYPE_LABELS } from "./format";
import { visibleMeasures } from "./measures";
import type { DraftField, SetDraft } from "./setDraft";
import { NumberStepper, StepperFrame } from "./NumberStepper";
import {
  CALORIES_STEP,
  DISTANCE_STEP,
  DURATION_STEP_S,
  WEIGHT_STEP,
  caloriesAtLimit,
  distanceAtLimit,
  durationAtLimit,
  repsAtLimit,
  stepCalories,
  stepDistance,
  stepDuration,
  stepName,
  stepReps,
  stepText,
  stepWeight,
  weightAtLimit,
  type StepDirection,
} from "./stepper";
import styles from "./SetFields.module.css";
import { WarmupToggle } from "./WarmupToggle";

export type DraftEditField = keyof Omit<SetDraft, "attemptKey">;

interface SetFieldsBase {
  modality: Modality;
  draft: SetDraft;
  errors: Partial<Record<DraftField, string>>;
  onChange: (field: DraftEditField, value: string) => void;
  /** Makes each control's id unique on a screen with many cards. */
  idPrefix: string;
}

/**
 * `entry`: the current-set panel (steppers, the Warm-up toggle and More, Spec 17.1 / 17.7), which names the exercise in
 * its controls' accessible names. `sheet`: the edit sheet's layout.
 */
export type SetFieldsProps = SetFieldsBase & ({ variant?: "sheet" } | { variant: "entry"; exerciseName: string });

const WEIGHT_UNITS = ["kg", "lb"] as const;
const DISTANCE_UNITS = DISTANCE_UNIT_VALUES; // Spec 05.3 D20: ft joins m, km, mi

type Common = SetFieldsBase & { id: (name: string) => string };

const SET_TYPE_OPTIONS = SET_TYPE_VALUES.map((type) => ({ value: type, label: SET_TYPE_LABELS[type] }));
const optionsOf = (units: readonly string[]) => units.map((unit) => ({ value: unit, label: unit }));

/** Spec 17.7 AC6: four fixed types, compared at a glance, so a Segmented rather than a menu. */
function SetTypeField({ draft, onChange, id }: Common) {
  return (
    <Segmented
      name={id("type")}
      legend="Set type"
      options={SET_TYPE_OPTIONS}
      value={draft.setType}
      onChange={(value) => onChange("setType", value)}
      hint={draft.setType === "failure" ? "Couldn't complete a rep? Log 0 reps." : undefined}
    />
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

/** A value and its unit inside the value's one Field, the unit under the value, so an error goes under both and never
 *  pulls the unit away from its value (#203). The label names the value; the unit strip's legend names the unit. */
function UnitField({ name, label, value, error, onChange, id, unitLabel, unit, units, onUnitChange }: { name: string; label: string; value: string; error?: string | undefined; onChange: (v: string) => void; id: (n: string) => string; unitLabel: string; unit: string; units: readonly string[]; onUnitChange: (v: string) => void }) {
  return (
    <Field id={id(name)} label={label} error={error}>
      {(control) => (
        <div className={styles.withUnit}>
          <input {...control} className={styles.input} type="text" inputMode="decimal" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
          <Segmented name={id(`${name}-unit`)} legend={unitLabel} options={optionsOf(units)} value={unit} onChange={onUnitChange} />
        </div>
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
export function SetFields(props: SetFieldsProps) {
  const id = (name: string) => `${props.idPrefix}-${name}`;
  return props.variant === "entry" ? <EntryFields {...props} id={id} /> : <SheetFields {...props} id={id} />;
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
                <UnitField key={measure} name="distance" label="Distance" value={draft.distance} error={errors.distance} onChange={(v) => onChange("distance", v)} id={id}
                  unitLabel="Distance unit" unit={draft.distanceUnit} units={DISTANCE_UNITS} onUnitChange={(v) => onChange("distanceUnit", v)} />
              );
            case "weight":
              return (
                <UnitField key={measure} name="weight" label={modality === "weighted_bodyweight" ? "Added weight" : "Weight"} value={draft.weight} error={errors.weight} onChange={(v) => onChange("weight", v)} id={id}
                  unitLabel="Weight unit" unit={draft.weightUnit} units={WEIGHT_UNITS} onUnitChange={(v) => onChange("weightUnit", v)} />
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
            case "calories":
              return <TextField key={measure} name="calories" label="Calories" inputMode="numeric" value={draft.calories} error={errors.calories} onChange={(v) => onChange("calories", v)} id={id} className={styles.input} />;
          }
        })}
      </div>
    </div>
  );
}

/**
 * Spec 17.1 §6.4–§6.5, Spec 17.8 AC11–AC13: one stepper per measure, weight, reps and calories as `NumberStepper`s,
 * distance stepping by its unit (`DISTANCE_STEP`), a duration as the same frame around its Minutes and Seconds fields.
 * `nameCarryUnit`: the entry panel's carry names its unit in the label ("Distance (ft)", Spec 18.1 D5), because the unit
 * is under More, so its stepper has no unit line. `below` draws under a measure (the sheet's unit strips).
 */
function StepperMeasures({ modality, draft, errors, onChange, id, exerciseName, nameCarryUnit, below }: Common & { exerciseName: string; nameCarryUnit: boolean; below?: (measure: MeasureName) => ReactNode }) {
  // Spec 17.8 AC3–AC4: the button shows the bare step ("+5"); its name carries the unit ("+5 lb, increase weight for X").
  const weightStep = WEIGHT_STEP[draft.weightUnit];
  const weightStepNamed = `${weightStep} ${draft.weightUnit}`;
  const distanceStep = DISTANCE_STEP[draft.distanceUnit];
  const distanceStepNamed = `${distanceStep} ${draft.distanceUnit}`;
  const carryLabel = nameCarryUnit && modality === "weight_distance";
  const figure = `${styles.input} ${styles.figureInput}`;
  const control = (measure: MeasureName): ReactNode => {
    switch (measure) {
      case "weight":
        return (
          <NumberStepper
            id={id("weight")}
            label={modality === "weighted_bodyweight" ? "Added weight" : "Weight"}
            unit={draft.weightUnit}
            value={draft.weight}
            inputMode="decimal"
            error={errors.weight}
            decreaseText={stepText("down", weightStep)}
            increaseText={stepText("up", weightStep)}
            decreaseLabel={stepName("down", weightStepNamed, "weight", exerciseName)}
            increaseLabel={stepName("up", weightStepNamed, "weight", exerciseName)}
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
            id={id("reps")}
            label="Reps"
            value={draft.reps}
            inputMode="numeric"
            error={errors.reps}
            decreaseText={stepText("down", 1)}
            increaseText={stepText("up", 1)}
            decreaseLabel={stepName("down", 1, "reps", exerciseName)}
            increaseLabel={stepName("up", 1, "reps", exerciseName)}
            canDecrease={!repsAtLimit(draft.reps, "down")}
            canIncrease={!repsAtLimit(draft.reps, "up")}
            onChange={(v) => onChange("reps", v)}
            onDecrease={() => onChange("reps", stepReps(draft.reps, "down"))}
            onIncrease={() => onChange("reps", stepReps(draft.reps, "up"))}
          />
        );
      case "distance":
        return (
          <NumberStepper
            id={id("distance")}
            label={carryLabel ? `Distance (${draft.distanceUnit})` : "Distance"}
            unit={carryLabel ? undefined : draft.distanceUnit}
            value={draft.distance}
            inputMode="decimal"
            error={errors.distance}
            decreaseText={stepText("down", distanceStep)}
            increaseText={stepText("up", distanceStep)}
            decreaseLabel={stepName("down", distanceStepNamed, "distance", exerciseName)}
            increaseLabel={stepName("up", distanceStepNamed, "distance", exerciseName)}
            canDecrease={!distanceAtLimit(draft.distance, draft.distanceUnit, "down")}
            canIncrease={!distanceAtLimit(draft.distance, draft.distanceUnit, "up")}
            onChange={(v) => onChange("distance", v)}
            onDecrease={() => onChange("distance", stepDistance(draft.distance, draft.distanceUnit, "down"))}
            onIncrease={() => onChange("distance", stepDistance(draft.distance, draft.distanceUnit, "up"))}
          />
        );
      case "calories":
        return (
          <NumberStepper
            id={id("calories")}
            label="Calories"
            unit="cal"
            value={draft.calories}
            inputMode="numeric"
            error={errors.calories}
            decreaseText={stepText("down", CALORIES_STEP)}
            increaseText={stepText("up", CALORIES_STEP)}
            decreaseLabel={stepName("down", CALORIES_STEP, "calories", exerciseName)}
            increaseLabel={stepName("up", CALORIES_STEP, "calories", exerciseName)}
            canDecrease={!caloriesAtLimit(draft.calories, "down")}
            canIncrease={!caloriesAtLimit(draft.calories, "up")}
            onChange={(v) => onChange("calories", v)}
            onDecrease={() => onChange("calories", stepCalories(draft.calories, "down"))}
            onIncrease={() => onChange("calories", stepCalories(draft.calories, "up"))}
          />
        );
      case "durationS": {
        // Two numeric fields, not "m:ss": a phone's numeric keypad has no colon (Spec 06.1 D10). A step rewrites both.
        const stepTo = (direction: StepDirection) => {
          const next = stepDuration(draft.minutes, draft.seconds, direction);
          onChange("minutes", next.minutes);
          onChange("seconds", next.seconds);
        };
        const durationStep = `${DURATION_STEP_S} s`;
        return (
          <StepperFrame
            decreaseText={stepText("down", durationStep)}
            increaseText={stepText("up", durationStep)}
            decreaseLabel={stepName("down", durationStep, "time", exerciseName)}
            increaseLabel={stepName("up", durationStep, "time", exerciseName)}
            canDecrease={!durationAtLimit(draft.minutes, draft.seconds, "down")}
            canIncrease={!durationAtLimit(draft.minutes, draft.seconds, "up")}
            onDecrease={() => stepTo("down")}
            onIncrease={() => stepTo("up")}
          >
            <div className={styles.durationFields}>
              <TextField name="minutes" label="Minutes" inputMode="numeric" value={draft.minutes} error={errors.minutes} onChange={(v) => onChange("minutes", v)} id={id} className={figure} />
              <TextField name="seconds" label="Seconds" inputMode="numeric" value={draft.seconds} error={errors.seconds} onChange={(v) => onChange("seconds", v)} id={id} className={figure} />
            </div>
          </StepperFrame>
        );
      }
    }
  };
  return (
    <div className={`${styles.measures} ${styles.entryMeasures}`}>
      {visibleMeasures(modality).map((measure) => {
        const extra = below?.(measure);
        return extra ? (
          <div key={measure} className={styles.withBelow}>
            {control(measure)}
            {extra}
          </div>
        ) : (
          <Fragment key={measure}>{control(measure)}</Fragment>
        );
      })}
    </div>
  );
}

/**
 * Spec 17.1 §6.4–§6.5, Spec 17.8 Phase B: a stepper for every measure (`StepperMeasures`).
 * Spec 17.7 Phase B: a Warm-up toggle and More in one row; More reveals set type and the units, scrolled clear of the bar.
 */
function EntryFields(props: Common & { exerciseName: string }) {
  const { modality, draft, onChange, id, exerciseName } = props;
  // More is open for one set: the attempt key changes when the set is logged (or an Undo restores one), so the next
  // set's panel starts compact and 17.4's post-log reveal can fit it above the bar (at 320 × 568 an open block could not).
  const [openFor, setOpenFor] = useState<string | null>(null);
  const optionsOpen = openFor === draft.attemptKey;
  const revealed = useRef<HTMLDivElement>(null);
  // AC16: only an opening scrolls; a block already open on mount, or closing, doesn't. The scroller's padding is 17.4's
  // --session-bar-clearance, so "nearest" lands it above the bar.
  useEffect(() => {
    if (optionsOpen) revealed.current?.scrollIntoView?.({ block: "nearest" });
  }, [optionsOpen]);
  const measures = visibleMeasures(modality);
  return (
    <div className={styles.fields}>
      <StepperMeasures {...props} nameCarryUnit />
      <div className={styles.panelActions}>
        <WarmupToggle exerciseName={exerciseName} pressed={draft.setType === "warmup"} onToggle={() => onChange("setType", draft.setType === "warmup" ? "working" : "warmup")} />
        <Button variant="secondary" aria-expanded={optionsOpen} aria-label={`More set options for ${exerciseName}`} onClick={() => setOpenFor(optionsOpen ? null : draft.attemptKey)}>
          More
        </Button>
      </div>
      {optionsOpen ? (
        <div className={styles.options} ref={revealed}>
          <SetTypeField {...props} />
          {measures.includes("weight") ? (
            <Segmented name={id("weight-unit")} legend="Weight unit" options={optionsOf(WEIGHT_UNITS)} value={draft.weightUnit} onChange={(value) => onChange("weightUnit", value)} />
          ) : null}
          {measures.includes("distance") ? (
            <Segmented name={id("distance-unit")} legend="Distance unit" options={optionsOf(DISTANCE_UNITS)} value={draft.distanceUnit} onChange={(value) => onChange("distanceUnit", value)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
