import { ConfirmDialog } from "../../../ui/ConfirmDialog";
import { HevyDeleteNote } from "../../hevy/send";
import { EDIT_COPY } from "./editCopy";

/**
 * Spec 18.0 AC18: shown only on the server's `409 workout-would-be-empty` (no client pre-check, D6). The one
 * destructive control of the edit screen: danger, the consequence stated, focus starting on Keep it. Spec 20.2 AC18:
 * it also says when the workout's Hevy copy stays.
 */
export function LastSetDialog({
  open,
  busy,
  workoutId,
  onKeep,
  onDelete,
}: {
  open: boolean;
  busy: boolean;
  workoutId: string;
  onKeep: () => void;
  onDelete: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title={EDIT_COPY.lastSet.title}
      confirmLabel={EDIT_COPY.lastSet.confirm}
      cancelLabel={EDIT_COPY.lastSet.cancel}
      variant="danger"
      busy={busy}
      onConfirm={onDelete}
      onCancel={onKeep}
    >
      <p>{EDIT_COPY.lastSet.body}</p>
      <HevyDeleteNote workoutId={workoutId} open={open} />
    </ConfirmDialog>
  );
}
