import { useId } from "react";

import { Button } from "../../ui/Button";
import { SheetActions } from "../../ui/SheetActions";
import styles from "./SetEditSheet.module.css";
import type { DeleteConfirm } from "./useDeleteConfirm";

export interface SetSheetActionsProps {
  /** The set form's id; the row's primary submits it. */
  formId: string;
  confirm: DeleteConfirm;
  /** The confirm's question ("Delete set 3? 47.5 kg × 6 will be removed."), or `null` in add mode (no Delete set). */
  question: string | null;
  /** "Save", or "Add set" in add mode. */
  primaryLabel: string;
  saving: boolean;
  deleting: boolean;
  /** The draft parses. */
  canSave: boolean;
  onDelete(): void;
  formError: string | null;
}

/**
 * Spec 17.10 AC14, with Spec 17.5's confirm: the set sheets' row. Editing, it is Delete set, Cancel, Save. Asking, Keep
 * set takes Delete set's place (so a double tap keeps the set) and the confirm's Delete set takes Save's, with the
 * question as the row's status line. A save failure is the row's notice, so it shows however far the body is scrolled.
 */
export function SetSheetActions({ formId, confirm, question, primaryLabel, saving, deleting, canSave, onDelete, formError }: SetSheetActionsProps) {
  const questionId = useId();
  const notice = formError ? (
    <p className={styles.formError} role="alert">
      {formError}
    </p>
  ) : null;
  if (confirm.confirming && question !== null) {
    return (
      <SheetActions
        notice={notice}
        status={
          <span id={questionId} className={styles.question}>
            {question}
          </span>
        }
        danger={
          <Button variant="secondary" ref={confirm.keepRef} aria-describedby={questionId} disabled={deleting} onClick={confirm.keep}>
            Keep set
          </Button>
        }
        primary={
          <Button variant="danger" aria-describedby={questionId} busy={deleting} onClick={onDelete}>
            Delete set
          </Button>
        }
      />
    );
  }
  return (
    <SheetActions
      notice={notice}
      danger={
        question !== null ? (
          <Button variant="danger" ref={confirm.askRef} disabled={saving || deleting} onClick={confirm.ask}>
            Delete set
          </Button>
        ) : undefined
      }
      primary={
        <Button type="submit" form={formId} busy={saving} disabled={!canSave || deleting}>
          {primaryLabel}
        </Button>
      }
    />
  );
}
