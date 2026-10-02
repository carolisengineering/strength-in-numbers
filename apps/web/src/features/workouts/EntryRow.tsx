import { useId, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { WorkoutExerciseDetail } from "@sin/core";

import { Button } from "../../ui/Button";
import { resolveFailure } from "./sessionErrors";
import { SetFields, type DraftEditField } from "./SetFields";
import {
  createDraftReducer,
  draftFromSet,
  parseDraft,
  unitDefaultsFor,
  type DraftField,
} from "./setDraft";
import { useCreateSet } from "./useWorkoutMutations";
import styles from "./EntryRow.module.css";

const reduceDraft = createDraftReducer(() => crypto.randomUUID());

/** Server field paths → the entry-row field they belong to (the API names measures, not inputs). */
const FIELD_FOR_PATH: Record<string, DraftField> = {
  weight: "weight",
  weightUnit: "weight",
  reps: "reps",
  distance: "distance",
  distanceUnit: "distance",
  durationS: "minutes",
  rpe: "rpe",
};

/** The free-text inputs: only these can show a client-side message once touched (units and type are selects). */
const TEXT_FIELDS: ReadonlySet<string> = new Set(["weight", "reps", "distance", "minutes", "seconds", "rpe"]);

export interface EntryRowProps {
  exercise: WorkoutExerciseDetail;
  unitPreference: "kg" | "lb";
  /** The workout is gone or finished elsewhere (§5.8 gone path). */
  onGone: () => void;
}

/**
 * The set-entry row (Spec 06.1 §5.4, D13): a **draft, not a server row**. It becomes one only when
 * "Log set" is tapped, and then it is already complete (`isComplete: true`), so the strict gate (05.1
 * D14) and the finish rule hold by construction. The draft starts from the last logged set (D14).
 * Each attempt carries one `clientGeneratedId`, kept across failures and re-minted only after a
 * success (§6.5), so a retry after a lost response cannot log the set twice.
 */
export function EntryRow({ exercise, unitPreference, onGone }: EntryRowProps) {
  const idPrefix = useId();
  const create = useCreateSet();
  const defaults = unitDefaultsFor(unitPreference);
  const [draft, dispatch] = useReducer(reduceDraft, undefined, () =>
    draftFromSet(exercise.sets.at(-1) ?? null, defaults, crypto.randomUUID()),
  );
  const [touched, setTouched] = useState<ReadonlySet<DraftField>>(new Set());
  const [serverErrors, setServerErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = useState<{ text: string } | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const inFlight = useRef(false); // synchronous guard against a double tap
  const firstTouchAt = useRef<number | null>(null);
  const edited = useRef(false);

  const parsed = useMemo(() => parseDraft(exercise.modalitySnapshot, draft), [exercise.modalitySnapshot, draft]);

  // Client-side messages appear only for fields the lifter has touched (an empty entry row is not an error).
  const clientErrors: Partial<Record<DraftField, string>> = {};
  if (!parsed.ok) {
    for (const [field, message] of Object.entries(parsed.errors) as [DraftField, string][]) {
      if (touched.has(field)) clientErrors[field] = message;
    }
  }

  function onChange(field: DraftEditField, value: string) {
    firstTouchAt.current ??= Date.now();
    edited.current = true;
    setServerErrors({});
    setFormError(null);
    if (TEXT_FIELDS.has(field)) setTouched((previous) => new Set(previous).add(field as DraftField));
    dispatch({ type: "edit", field, value });
  }

  async function log(event?: FormEvent) {
    event?.preventDefault();
    if (inFlight.current || !parsed.ok) return;
    inFlight.current = true;
    setServerErrors({});
    setFormError(null);
    const msToLog = firstTouchAt.current === null ? 0 : Date.now() - firstTouchAt.current;
    try {
      const set = await create.mutateAsync({
        workoutExerciseId: exercise.id,
        body: { ...parsed.body, isComplete: true, clientGeneratedId: draft.attemptKey },
        modality: exercise.modalitySnapshot,
        msToLog,
        edited: edited.current,
      });
      dispatch({ type: "logged", set });
      setTouched(new Set());
      setAnnouncement(`Set ${set.setNumber} logged`);
      firstTouchAt.current = null;
      edited.current = false;
    } catch (error) {
      const action = resolveFailure("create-set", error);
      if (action.type === "gone") {
        onGone();
      } else if (action.type === "fields") {
        const matched: Partial<Record<DraftField, string>> = {};
        let unmatched: string | null = null;
        for (const { path, message } of action.fieldErrors) {
          const field = FIELD_FOR_PATH[path.split(/[./]/).at(-1) ?? ""];
          if (field) matched[field] ??= message;
          else unmatched ??= message;
        }
        setServerErrors(matched);
        if (unmatched !== null || Object.keys(matched).length === 0) {
          setFormError({ text: unmatched ?? "Couldn't log set — check the values and try again" });
        }
      } else {
        setFormError({ text: action.type === "retry" ? action.text : "Couldn't log set — try again" });
      }
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form className={styles.row} onSubmit={(event) => void log(event)} noValidate aria-label={`Log a set of ${exercise.exerciseNameSnapshot}`}>
      <p className={styles.setNumber}>Set {exercise.sets.length + 1}</p>
      <SetFields
        modality={exercise.modalitySnapshot}
        draft={draft}
        errors={{ ...clientErrors, ...serverErrors }}
        onChange={onChange}
        idPrefix={idPrefix}
      />
      {formError ? (
        <p className={styles.formError} role="alert">
          {formError.text}
        </p>
      ) : null}
      <p className={styles.visuallyHidden} role="status">
        {announcement}
      </p>
      {/* Not `busy`: a disabled button drops focus in some browsers; the in-flight ref blocks a double tap. */}
      <Button type="submit" block disabled={!parsed.ok} aria-busy={create.isPending || undefined}>
        Log set
      </Button>
    </form>
  );
}
