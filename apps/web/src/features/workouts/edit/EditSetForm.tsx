import { useEffect, useMemo, useReducer, useRef, useState, type FormEvent } from "react";
import type { Modality, SetEntry } from "@sin/core";

import { Button } from "../../../ui/Button";
import { reportUnexpected } from "../reportUnexpected";
import type { EditScreenMode } from "../screenMode";
import { SetFields, type DraftEditField } from "../SetFields";
import {
  createDraftReducer,
  diffForPatch,
  draftFieldForPath,
  draftFromSet,
  parseDraft,
  seedDraft,
  unitDefaultsFor,
  type DraftField,
} from "../setDraft";
import styles from "../SetEditSheet.module.css";
import { EDIT_COPY } from "./editCopy";
import { resolveEditFailure } from "./editFailure";
import { useEditCreateSet, useEditDeleteSet, useEditUpdateSet } from "./useEditMutations";

export type EditSetTarget =
  | { readonly kind: "edit"; readonly set: SetEntry }
  | { readonly kind: "add"; readonly workoutExerciseId: string; readonly sets: readonly SetEntry[] };

export interface EditSetFormProps {
  target: EditSetTarget;
  modality: Modality;
  unitPreference: "kg" | "lb";
  onClose: () => void;
  mode: EditScreenMode;
}

type SetOperation = "create-set" | "update-set" | "delete-set";

// Typing never re-mints the key: only a new opening of the sheet does (the form is keyed per opening).
const reduceDraft = createDraftReducer(() => crypto.randomUUID());

/**
 * Spec 18.0 AC6–AC8: the set sheet's body on the edit screen. Pessimistic: it closes only on the server's
 * answer, and every failure stays here with the typed values (AC14–AC16). Add mode copies the last set forward
 * with no plan (D16) and keeps one `clientGeneratedId` for every retry of this opening (AC17).
 */
export function EditSetForm({ target, modality, unitPreference, onClose, mode }: EditSetFormProps) {
  const create = useEditCreateSet();
  const update = useEditUpdateSet();
  const del = useEditDeleteSet();
  const defaults = unitDefaultsFor(unitPreference);
  const [draft, dispatch] = useReducer(reduceDraft, undefined, () =>
    target.kind === "add"
      ? seedDraft({ plannedSets: [], sets: target.sets, defaults, attemptKey: crypto.randomUUID() })
      : // `draftFromSet` drafts a *new* set as working; an edit keeps the stored type (a warm-up stays a warm-up).
        { ...draftFromSet(target.set, defaults, "edit"), setType: target.set.setType },
  );
  const [serverErrors, setServerErrors] = useState<Partial<Record<DraftField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const inFlight = useRef(false);
  // The sheet can be closed while a write is in flight: a late answer must not close a sheet opened since.
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const close = () => {
    if (mounted.current) onClose();
  };
  const parsed = useMemo(() => parseDraft(modality, draft), [modality, draft]);
  const busy = create.isPending || update.isPending || del.isPending;
  const errors: Partial<Record<DraftField, string>> = { ...(parsed.ok ? {} : parsed.errors), ...serverErrors };

  function onChange(field: DraftEditField, value: string) {
    setServerErrors({});
    setFormError(null);
    dispatch({ type: "edit", field, value });
  }

  function failed(op: SetOperation, error: unknown) {
    reportUnexpected(op, error);
    const failure = resolveEditFailure(op, error);
    switch (failure.type) {
      case "fields": {
        const matched: Partial<Record<DraftField, string>> = {};
        let unmatched: string | null = null;
        for (const { path, message } of failure.fieldErrors) {
          const field = draftFieldForPath(path);
          if (field) matched[field] ??= message;
          else unmatched ??= message;
        }
        setServerErrors(matched);
        if (unmatched !== null || Object.keys(matched).length === 0) setFormError(unmatched ?? failure.fallback);
        return;
      }
      case "message":
        setFormError(failure.text);
        return;
      case "missing":
      case "last-set":
      case "vanished":
        close();
        mode.report(failure);
        return;
      default:
        // `done` never reaches here (the delete hook turns a 404 into success); no other kind applies to a set route.
        setFormError(EDIT_COPY.retry[op]);
    }
  }

  async function run(op: SetOperation, write: () => Promise<string | null>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setFormError(null);
    try {
      const announcement = await write();
      if (announcement === null) return;
      close();
      mode.report({ type: "saved", announcement });
    } catch (error) {
      failed(op, error);
    } finally {
      inFlight.current = false;
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!parsed.ok) return;
    const body = parsed.body;
    if (target.kind === "add") {
      void run("create-set", async () => {
        const created = await create.mutateAsync({
          workoutId: mode.workoutId,
          workoutExerciseId: target.workoutExerciseId,
          body: { ...body, isComplete: true, clientGeneratedId: draft.attemptKey },
        });
        return EDIT_COPY.setAdded(created.setNumber);
      });
      return;
    }
    const { set } = target;
    const patch = diffForPatch(set, body);
    if (patch === null) {
      onClose(); // nothing changed: no request
      return;
    }
    void run("update-set", async () => {
      await update.mutateAsync({ workoutId: mode.workoutId, id: set.id, body: patch });
      return EDIT_COPY.setSaved(set.setNumber);
    });
  }

  function remove(set: SetEntry) {
    void run("delete-set", async () => {
      await del.mutateAsync({ workoutId: mode.workoutId, id: set.id });
      return EDIT_COPY.setDeleted;
    });
  }

  const idPrefix = target.kind === "edit" ? `edit-${target.set.id}` : `add-${target.workoutExerciseId}`;
  return (
    <form className={styles.form} onSubmit={submit} noValidate>
      <SetFields modality={modality} draft={draft} errors={errors} onChange={onChange} idPrefix={idPrefix} />
      {formError ? (
        <p className={styles.formError} role="alert">
          {formError}
        </p>
      ) : null}
      <div className={styles.actions}>
        {target.kind === "edit" ? (
          <Button variant="danger" disabled={busy} onClick={() => remove(target.set)}>
            Delete set
          </Button>
        ) : null}
        <Button type="submit" busy={create.isPending || update.isPending} disabled={!parsed.ok || del.isPending}>
          {target.kind === "add" ? "Add set" : "Save"}
        </Button>
      </div>
    </form>
  );
}
