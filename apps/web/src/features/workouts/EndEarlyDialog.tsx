import { ConfirmDialog } from "../../ui/ConfirmDialog";
import type { UnloggedPlanned } from "./unloggedPlanned";

export interface EndEarlyDialogProps {
  open: boolean;
  unlogged: UnloggedPlanned;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const sets = (n: number) => (n === 1 ? "1 set" : `${n} sets`);

/**
 * Spec 17.1 AC33, §6.7: what ending now leaves out. Its confirm runs the same `confirmFinish` as Finish, so every wait,
 * block and failure message is identical. Spec 17.2 may replace the title and children, never the call.
 */
export function EndEarlyDialog({ open, unlogged, busy, onConfirm, onCancel }: EndEarlyDialogProps) {
  return (
    <ConfirmDialog open={open} title="End workout early?" confirmLabel="End workout" cancelLabel="Keep logging" busy={busy} onConfirm={onConfirm} onCancel={onCancel}>
      <ul>
        {unlogged.byExercise.map((e) => (
          <li key={e.id}>
            {e.name} · {sets(e.count)}
          </li>
        ))}
      </ul>
      <p>{unlogged.total === 1 ? "1 planned set not logged" : `${unlogged.total} planned sets not logged`}</p>
      <p>A finished workout can't be edited.</p>
    </ConfirmDialog>
  );
}
