import { useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { Modality, SetEntry } from "@sin/core";

import { Button } from "../../ui/Button";
import { Sheet } from "../../ui/Sheet";
import { reportUnexpected } from "./reportUnexpected";
import { resolveFailure } from "./sessionErrors";
import { SetFields, type DraftEditField } from "./SetFields";
import {
  createDraftReducer,
  diffForPatch,
  draftFieldForPath,
  draftFromSet,
  parseDraft,
  unitDefaultsFor,
  type DraftField,
} from "./setDraft";
import { useDeleteSet, useUpdateSet } from "./useWorkoutMutations";
import styles from "./SetEditSheet.module.css";

const reduceDraft = createDraftReducer(() => "edit"); // an edit has no idempotency key to mint

export interface SetEditSheetProps {
  /** The set being edited, or `null` while the sheet is closed. */
  set: SetEntry | null;
  modality: Modality;
  exerciseName: string;
  unitPreference: "kg" | "lb";
  onClose: () => void;
  /** The workout is gone or finished elsewhere (§5.8 gone path); `reason` feeds `workout_conflict`. */
  onGone: (reason: "gone" | "finished") => void;
}

/**
 * Edit or delete a logged set in a `<Sheet>` (Spec 06.1 §5.5, D8): the same `SetFields` as the entry
 * row, prefilled from the stored set. Editing never offers "un-complete": a logged set is complete,
 * and the only way to remove a mistaken one is Delete.
 */
export function SetEditSheet({ set, ...rest }: SetEditSheetProps) {
  return (
    <Sheet
      open={set !== null}
      title={set ? `Set ${set.setNumber} · ${rest.exerciseName}` : "Edit set"}
      onClose={rest.onClose}
    >
      {/* Keyed by set id so each open starts from that set's values. */}
      {set ? <EditForm key={set.id} set={set} {...rest} /> : null}
    </Sheet>
  );
}

function EditForm({
  set,
  modality,
  unitPreference,
  onClose,
  onGone,
}: SetEditSheetProps & { set: SetEntry }) {
  const update = useUpdateSet();
  const del = useDeleteSet();
  const [draft, dispatch] = useReducer(reduceDraft, undefined, () =>
    draftFromSet(set, unitDefaultsFor(unitPreference), "edit"),
  );
  const [serverErrors, setServerErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const parsed = useMemo(() => parseDraft(modality, draft), [modality, draft]);
  const busy = update.isPending || del.isPending;

  // Everything is shown here, not only touched fields: someone opening a set flagged "Needs data"
  // has come to fix exactly what is missing.
  const errors: Partial<Record<DraftField, string>> = { ...(parsed.ok ? {} : parsed.errors), ...serverErrors };

  function onChange(field: DraftEditField, value: string) {
    setServerErrors({});
    setFormError(null);
    dispatch({ type: "edit", field, value });
  }

  function failed(op: "update-set" | "delete-set", error: unknown) {
    reportUnexpected(op, error);
    const action = resolveFailure(op, error);
    if (action.type === "gone") {
      onClose();
      onGone(action.reason);
    } else if (action.type === "fields") {
      const matched: Partial<Record<DraftField, string>> = {};
      let unmatched: string | null = null;
      for (const { path, message } of action.fieldErrors) {
        const field = draftFieldForPath(path);
        if (field) matched[field] ??= message;
        else unmatched ??= message;
      }
      setServerErrors(matched);
      if (unmatched !== null || Object.keys(matched).length === 0) {
        setFormError(unmatched ?? "Couldn't save the set — check the values and try again");
      }
    } else if (action.type === "retry") {
      setFormError(action.text);
    } else if (action.type === "ok") {
      onClose();
    }
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    if (inFlight.current || !parsed.ok) return;
    const patch = diffForPatch(set, parsed.body);
    if (patch === null) {
      onClose(); // nothing changed: no request
      return;
    }
    inFlight.current = true;
    setFormError(null);
    try {
      await update.mutateAsync({ id: set.id, body: patch, modality });
      onClose();
    } catch (error) {
      failed("update-set", error);
    } finally {
      inFlight.current = false;
    }
  }

  async function remove() {
    if (inFlight.current) return;
    inFlight.current = true;
    setFormError(null);
    try {
      await del.mutateAsync({ id: set.id, modality });
      onClose();
    } catch (error) {
      failed("delete-set", error);
    } finally {
      inFlight.current = false;
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
      <SetFields modality={modality} draft={draft} errors={errors} onChange={onChange} idPrefix={`edit-${set.id}`} />
      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}
      <div className={styles.actions}>
        <Button variant="danger" disabled={busy} onClick={() => void remove()}>
          Delete set
        </Button>
        <Button type="submit" busy={update.isPending} disabled={!parsed.ok || del.isPending}>
          Save
        </Button>
      </div>
    </form>
  );
}
