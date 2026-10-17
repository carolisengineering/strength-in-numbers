import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { FinishDialogBody } from "./FinishDialog";
import type { FinishStatsValue } from "./finishStats";
import type { UnloggedPlanned } from "./unloggedPlanned";

export interface EndEarlyDialogProps {
  open: boolean;
  unlogged: UnloggedPlanned;
  stats: FinishStatsValue;
  unitPreference: "kg" | "lb";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Spec 17.1 AC33, §6.7: what ending now leaves out. Its confirm runs the same `confirmFinish` as Finish, so every wait,
 * block and failure message is identical. Spec 17.2 replaced the children (stats, flag, list, note); the call is unchanged.
 */
export function EndEarlyDialog({ open, unlogged, stats, unitPreference, busy, onConfirm, onCancel }: EndEarlyDialogProps) {
  return (
    <ConfirmDialog open={open} title="End workout early?" confirmLabel="End workout" cancelLabel="Keep logging" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <FinishDialogBody stats={stats} unitPreference={unitPreference} unlogged={unlogged} note="Unlogged sets aren't saved. You can't edit a workout after finishing it." />
    </ConfirmDialog>
  );
}
