import { useRef, useState, type FormEvent } from "react";
import type { UseMutationResult } from "@tanstack/react-query";
import type { UpdatedWorkout, WorkoutDetail } from "@sin/core";

import { Button } from "../../../ui/Button";
import { Field } from "../../../ui/Field";
import { InlineNotice } from "../../../ui/InlineNotice";
import { Sheet } from "../../../ui/Sheet";
import { EDIT_COPY } from "../edit/editCopy";
import { reportUnexpected } from "../reportUnexpected";
import {
  buildPatch,
  changeTimeFailure,
  dayBounds,
  initialValues,
  validate,
  type ChangeTimeErrors,
  type ChangeTimeField,
  type ChangeTimeForm,
} from "./changeTime";
import styles from "./ChangeTimeSheet.module.css";
import type { ChangeTimeVars } from "./useChangeTime";

export interface ChangeTimeSheetProps {
  open: boolean;
  workout: WorkoutDetail;
  mutation: UseMutationResult<UpdatedWorkout, Error, ChangeTimeVars>;
  onClose: () => void;
  onSaved: () => void;
  onVanished: () => void;
}

const HINT_ID = "change-time-took-hint";
const TOOK_ERROR_ID = "change-time-took-error";

/**
 * Spec 18.0 AC30–AC33, AC41–AC42: Day, Started at and Took, committed once on Save time. Only the
 * changed groups are sent; a client error (or the `resolveRetime` pre-check) blocks the request; a
 * failure keeps the typed values, and the sheet cannot be closed while a save is in flight. The owner keys it per opening, so each opening starts from the
 * stored workout.
 */
export function ChangeTimeSheet({ open, workout: latest, mutation, onClose, onSaved, onVanished }: ChangeTimeSheetProps) {
  const [openedAt] = useState(() => new Date());
  // The whole sheet works from the workout as it opened (deferred minor 15): a refetch landing while it is open
  // changes neither "what changed", nor live vs finished, nor what is validated and sent; the server has the last word.
  const [workout] = useState(() => latest);
  const [form, setForm] = useState<ChangeTimeForm>(() => initialValues(workout));
  const [errors, setErrors] = useState<ChangeTimeErrors>({});
  const [requestId, setRequestId] = useState<string | null>(null);
  const inFlight = useRef(false);
  // Took inputs the browser cannot read as a number (`badInput`) report "", which must not count as blank.
  const [unreadable, setUnreadable] = useState({ hours: false, minutes: false });
  const live = workout.endedAt === null;
  const bounds = dayBounds(openedAt);

  function change(key: keyof ChangeTimeForm, value: string) {
    const field: ChangeTimeField = key === "hours" || key === "minutes" ? "took" : key;
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [field]: undefined, form: undefined }));
    setRequestId(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current) return;
    if (unreadable.hours || unreadable.minutes) {
      setErrors({ took: EDIT_COPY.tookWhole });
      return;
    }
    const built = buildPatch(workout, form);
    if (!built.ok) {
      setErrors(built.errors);
      return;
    }
    if (built.patch === null) {
      onClose(); // nothing changed: no request
      return;
    }
    const rejected = validate(workout, built.patch, new Date());
    if (rejected !== null) {
      setErrors(rejected);
      return;
    }
    inFlight.current = true;
    setErrors({});
    setRequestId(null);
    try {
      await mutation.mutateAsync({ workout, patch: built.patch });
      onClose();
      onSaved();
    } catch (error) {
      reportUnexpected("change-time", error);
      const failure = changeTimeFailure(error);
      if (failure.type === "vanished") {
        onClose();
        onVanished();
      } else if (failure.type === "fields") {
        setErrors(failure.errors);
      } else {
        setErrors({ form: failure.text });
        setRequestId(failure.requestId);
      }
    } finally {
      inFlight.current = false;
    }
  }

  const tookDescribedBy = [live ? HINT_ID : null, errors.took ? TOOK_ERROR_ID : null].filter(Boolean).join(" ") || undefined;
  const tookInput = (key: "hours" | "minutes", max: number) => (control: { id: string }) => (
    <input
      id={control.id}
      aria-describedby={tookDescribedBy}
      aria-invalid={errors.took ? true : undefined}
      type="number"
      inputMode="numeric"
      min={0}
      max={max}
      step={1}
      className={styles.input}
      value={form[key]}
      onChange={(e) => {
        setUnreadable((u) => ({ ...u, [key]: e.target.validity.badInput }));
        change(key, e.target.value);
      }}
    />
  );

  return (
    // A save in flight keeps the sheet open, so its failure is shown where the lifter can see it (AC41, DM-12).
    <Sheet open={open} title="Change Time" onClose={onClose} dismissible={!mutation.isPending}>
      <form className={styles.form} noValidate onSubmit={(event) => void submit(event)}>
        <Field id="change-time-day" label="Day" {...(errors.day ? { error: errors.day } : {})}>
          {(control) => (
            <input
              {...control}
              type="date"
              min={bounds.min}
              max={bounds.max}
              className={styles.input}
              value={form.day}
              onChange={(e) => change("day", e.target.value)}
            />
          )}
        </Field>
        <Field id="change-time-time" label="Started at" {...(errors.time ? { error: errors.time } : {})}>
          {(control) => (
            <input {...control} type="time" className={styles.input} value={form.time} onChange={(e) => change("time", e.target.value)} />
          )}
        </Field>
        <fieldset className={styles.took}>
          <legend className={styles.legend}>Took</legend>
          <div className={styles.tookRow}>
            <Field id="change-time-hours" label="Hours">
              {tookInput("hours", 24)}
            </Field>
            <Field id="change-time-minutes" label="Minutes">
              {tookInput("minutes", 59)}
            </Field>
          </div>
          {live ? (
            <p id={HINT_ID} className={styles.hint}>
              {EDIT_COPY.tookHint}
            </p>
          ) : null}
          {errors.took ? (
            <p id={TOOK_ERROR_ID} className={styles.error} role="alert">
              {errors.took}
            </p>
          ) : null}
        </fieldset>
        {errors.form ? (
          <InlineNotice tone="error" requestId={requestId}>
            {errors.form}
          </InlineNotice>
        ) : null}
        <Button type="submit" block busy={mutation.isPending}>
          Save time
        </Button>
      </form>
    </Sheet>
  );
}
