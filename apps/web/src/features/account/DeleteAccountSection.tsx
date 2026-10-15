import { useCallback, useEffect, useId, useRef, useState } from "react";

import { Button } from "../../ui/Button";
import { ConfirmDialog } from "../../ui/ConfirmDialog";
import { isAccountDeleted, isSessionEnded } from "./accountDeleted";
import { deleteFailure, type FailureCopy } from "./failureCopy";
import { ExportControl } from "./ExportControl";
import { MESSAGES, STEP_SETTLE_MS } from "./messages";
import { useDeleteAccount } from "./useDeleteAccount";
import type { ExportAccount } from "./useExportAccount";
import styles from "./DeleteAccountSection.module.css";

type Step = 1 | 2;

export interface DeleteAccountSectionProps {
  /** The Profile form's single exporter (D13), so the dialog's download and the section's share one request. */
  exporter: ExportAccount;
  /** The profile's IANA zone, handed to the mutation so the confirmation can format the erase date. */
  timeZone: string;
}

/**
 * Profile → "Delete account" and its two-step confirmation (Spec 12 AC13-AC19, §6.4). One
 * `ConfirmDialog` whose props switch by step. Cancel (button, Escape, Android back) resets the flow but
 * cannot unsend a request already on the wire; a failure reopens at step 2 (D11). Success needs no
 * handling here: the mutation result flips `ProtectedLayout` to the confirmation screen.
 */
export function DeleteAccountSection({ exporter, timeZone }: DeleteAccountSectionProps) {
  const headingId = useId();
  const mutation = useDeleteAccount();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [failure, setFailure] = useState<FailureCopy | null>(null);
  const [settled, setSettled] = useState(false);
  const sending = useRef(false);

  // AC16: Delete my account is inert for STEP_SETTLE_MS after step 2 appears, so the second tap of a
  // double-tap on Continue (same screen position) cannot confirm. Not re-applied after a failure.
  useEffect(() => {
    if (!open || step !== 2) return;
    setSettled(false);
    const timer = setTimeout(() => setSettled(true), STEP_SETTLE_MS);
    return () => clearTimeout(timer);
  }, [open, step]);

  const close = useCallback(() => {
    setOpen(false);
    setStep(1);
    setFailure(null);
  }, []);

  const confirm = useCallback(() => {
    if (step === 1) {
      setStep(2);
      return;
    }
    if (!settled || sending.current) return;
    sending.current = true;
    setFailure(null);
    mutation.mutate(
      { timeZone },
      {
        onError: (error) => {
          sending.current = false;
          // A 403 account-deleted is "done" (the `me` invalidation swaps the screen, D7) and a 401 means
          // onAuthLost has started the logout (AC10, AC19): neither shows a message.
          if (isAccountDeleted(error) || isSessionEnded(error)) return;
          setSettled(true);
          setFailure(deleteFailure(error));
          setStep(2);
          setOpen(true); // reopen even if the user pressed Escape while it was in flight (D11)
        },
      },
    );
  }, [step, settled, mutation, timeZone]);

  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.title} id={headingId}>
        {MESSAGES.deleteTitle}
      </h2>
      <p className={styles.body}>{MESSAGES.deleteBody}</p>
      <Button variant="danger" block onClick={() => setOpen(true)}>
        {MESSAGES.deleteTrigger}
      </Button>

      <ConfirmDialog
        open={open}
        title={step === 1 ? MESSAGES.step1Title : MESSAGES.step2Title}
        confirmLabel={step === 1 ? MESSAGES.step1Continue : MESSAGES.step2Confirm}
        variant={step === 1 ? "primary" : "danger"}
        busy={mutation.isPending}
        confirmDisabled={step === 2 && !settled}
        focusKey={step}
        onConfirm={confirm}
        onCancel={close}
      >
        {step === 1 ? (
          <div className={styles.dialogBody}>
            <p>{MESSAGES.step1Body}</p>
            <p>{MESSAGES.step1Backups}</p>
            <ExportControl exporter={exporter} idleLabel={MESSAGES.downloadFirst} />
          </div>
        ) : (
          <div className={styles.dialogBody}>
            <p>{MESSAGES.step2Body}</p>
            {failure ? (
              <p className={styles.error} role="alert">
                <span>{failure.text}</span>
                {failure.requestId ? <span> Request ID: {failure.requestId}</span> : null}
              </p>
            ) : null}
          </div>
        )}
      </ConfirmDialog>
    </section>
  );
}
