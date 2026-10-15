import { Button } from "../../ui/Button";
import { InlineNotice } from "../../ui/InlineNotice";
import { exportFailure } from "./failureCopy";
import { MESSAGES } from "./messages";
import styles from "./ExportControl.module.css";
import type { ExportAccount } from "./useExportAccount";

export interface ExportControlProps {
  exporter: ExportAccount;
  /** "Download my data" in the section, "Download my data first" in the dialog. */
  idleLabel: string;
  block?: boolean;
}

/** The export button and its feedback (Spec 12 AC6, AC7, AC9). The status region always exists so a screen reader hears it fill (AC23). */
export function ExportControl({ exporter, idleLabel, block = false }: ExportControlProps) {
  const { state, exportNow, saveAgain } = exporter;
  const preparing = state.status === "preparing";
  const failure = state.status === "error" ? exportFailure(state.error) : null;

  return (
    <div className={styles.control}>
      <Button
        variant={block ? "primary" : "secondary"}
        block={block}
        busy={preparing}
        onClick={exportNow}
      >
        {preparing ? MESSAGES.preparing : idleLabel}
      </Button>
      <p className={styles.status} role="status" aria-live="polite">
        {state.status === "saved" ? MESSAGES.saved(state.filename) : ""}
        {preparing ? MESSAGES.preparing : ""}
      </p>
      {state.status === "saved" ? (
        <Button variant="secondary" onClick={saveAgain}>
          {MESSAGES.downloadAgain}
        </Button>
      ) : null}
      {failure ? (
        <InlineNotice tone="error" requestId={failure.requestId} actionLabel={MESSAGES.tryAgain} onAction={exportNow}>
          {failure.text}
        </InlineNotice>
      ) : null}
    </div>
  );
}
