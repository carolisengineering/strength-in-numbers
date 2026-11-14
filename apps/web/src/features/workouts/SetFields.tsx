import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { DISTANCE_UNIT_VALUES, SET_TYPE_VALUES, type MeasureName, type Modality } from "@sin/core";

import { Button } from "../../ui/Button";
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
import fieldStyles from "../../ui/Field.module.css";
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
  /** Named in the steppers' accessible names ("+5 lb, increase weight for Bench", Spec 17.8 AC4, AC16). */
  exerciseName: string;
}

/**
 * `entry`: the current-set panel (steppers, the Warm-up toggle and More, Spec 17.1 / 17.7). `sheet`: the edit sheet's
 * layout, with the same steppers and the set type and units shown (Spec 17.8 AC16).
 */
export type SetFieldsProps = SetFieldsBase & {
  variant?: "sheet" | "entry";
  /** Minor 449 (entry only): the row's successful logs so far. More stays open until the lifter closes it or this changes. */
  logCount?: number;
};

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

/**
 * One of a duration's two inputs, wired like a `Field`'s control: named by `aria-label` ("Minutes" starts with the "min"
 * shown under it, "Seconds" with the "s", WCAG 2.5.3), its error below the row and linked by `aria-describedby`.
 */
function DurationInput({ name, label, value, error, onChange, id, className }: { name: "minutes" | "seconds"; label: string; value: string; error?: string | undefined; onChange: (v: string) => void; id: (n: string) => string; className: string | undefined }) {
  return (
    <input
      id={id(name)}
      aria-label={label}
      aria-describedby={error ? `${id(name)}-error` : undefined}
      aria-invalid={error ? true : undefined}
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={value}
      // Spec 17.8 AC17: focus selects the text, as a stepper's field does, so typing replaces it.
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => onChange(e.target.value)}
    />
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
  const { draft, onChange, id } = props;
  // Spec 17.8 AC16: the sheet's label stays "Distance", so its unit strip names the unit; `nameCarryUnit` is off.
  const below = (measure: MeasureName): ReactNode =>
    measure === "weight" ? (
      <Segmented name={id("weight-unit")} legend="Weight unit" options={optionsOf(WEIGHT_UNITS)} value={draft.weightUnit} onChange={(value) => onChange("weightUnit", value)} />
    ) : measure === "distance" ? (
      <Segmented name={id("distance-unit")} legend="Distance unit" options={optionsOf(DISTANCE_UNITS)} value={draft.distanceUnit} onChange={(value) => onChange("distanceUnit", value)} />
    ) : null;
  return (
    <div className={styles.fields}>
      <SetTypeField {...props} />
      <StepperMeasures {...props} nameCarryUnit={false} below={below} />
    </div>
  );
}

/**
 * Spec 17.1 §6.4–§6.5, Spec 17.8 AC11–AC13: one stepper per measure, weight, reps and calories as `NumberStepper`s,
 * distance stepping by its unit (`DISTANCE_STEP`), a duration as the same frame around its Minutes and Seconds fields.
 * `nameCarryUnit`: the entry panel's carry names its unit in the label ("Distance (ft)", Spec 18.1 D5), because the unit
 * is under More, so its stepper has no unit line. `below` is a weight's or distance's unit strip (the sheet's), drawn in
 * the unit line's place.
 */
function StepperMeasures({ modality, draft, errors, onChange, id, exerciseName, nameCarryUnit, below }: Common & { nameCarryUnit: boolean; below?: (measure: MeasureName) => ReactNode }) {
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
            below={below?.("weight")}
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
            below={below?.("distance")}
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
          // Minors 462, 463: the shape of every other stepper, a label above ("Time"), one row of − inputs +, and the
          // units under the figures ("min", "s") where a weight shows "lb". The row holds only the two inputs, so
          // −5 s / +5 s center on the figures by structure, and the two fields stay side by side down to 320 px (as
          // field labels, "Minutes" and "Seconds" were wider than the 44 px each field gets there), which keeps the
          // panel above the bar. The inputs keep "Minutes" and "Seconds" as their names.
          <div role="group" aria-labelledby={id("duration-label")} className={`${fieldStyles.field} ${styles.duration}`} data-duration="">
            <span className={fieldStyles.label} id={id("duration-label")}>
              Time
            </span>
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
              <div className={styles.durationPair}>
                <DurationInput name="minutes" label="Minutes" value={draft.minutes} error={errors.minutes} onChange={(v) => onChange("minutes", v)} id={id} className={figure} />
                <DurationInput name="seconds" label="Seconds" value={draft.seconds} error={errors.seconds} onChange={(v) => onChange("seconds", v)} id={id} className={figure} />
              </div>
            </StepperFrame>
            <div className={styles.durationLine} aria-hidden="true">
              <div className={styles.durationPair}>
                <span className={styles.durationUnit}>min</span>
                <span className={styles.durationUnit}>s</span>
              </div>
            </div>
            {errors.minutes || errors.seconds ? (
              <div className={styles.durationLine}>
                <div className={styles.durationPair}>
                  {errors.minutes ? (
                    <p className={`${fieldStyles.error} ${styles.minutesCell}`} id={`${id("minutes")}-error`} role="alert">
                      {errors.minutes}
                    </p>
                  ) : null}
                  {errors.seconds ? (
                    <p className={`${fieldStyles.error} ${styles.secondsCell}`} id={`${id("seconds")}-error`} role="alert">
                      {errors.seconds}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>
        );
      }
    }
  };
  return (
    <div className={`${styles.measures} ${styles.entryMeasures}`}>
      {visibleMeasures(modality).map((measure) => (
        <Fragment key={measure}>{control(measure)}</Fragment>
      ))}
    </div>
  );
}

/**
 * Spec 17.1 §6.4–§6.5, Spec 17.8 Phase B: a stepper for every measure (`StepperMeasures`).
 * Spec 17.7 Phase B: a Warm-up toggle and More in one row; More reveals set type and the units, scrolled clear of the bar.
 */
function EntryFields(props: Common & { exerciseName: string; logCount?: number | undefined }) {
  const { modality, draft, onChange, id, exerciseName, logCount = 0 } = props;
  // More is open for one log: a successful log closes it, so the next set's panel starts compact and 17.4's post-log
  // reveal can fit it above the bar (at 320 × 568 an open block could not). Minor 449: nothing else closes it (an Undo
  // restore, a re-seed after a correction, a delete or another device's set), so focus in its strips is never dropped.
  const [openFor, setOpenFor] = useState<number | null>(null);
  const optionsOpen = openFor === logCount;
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
        <Button variant="secondary" aria-expanded={optionsOpen} aria-label={`More set options for ${exerciseName}`} onClick={() => setOpenFor(optionsOpen ? null : logCount)}>
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
