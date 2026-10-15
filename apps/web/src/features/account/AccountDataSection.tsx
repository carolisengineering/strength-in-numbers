import { useId } from "react";

import { ExportControl } from "./ExportControl";
import { MESSAGES } from "./messages";
import styles from "./AccountDataSection.module.css";
import type { ExportAccount } from "./useExportAccount";

/** Profile → "Your data" (Spec 12 AC5). The exporter is owned by the Profile form so the delete dialog shares it (D13). */
export function AccountDataSection({ exporter }: { exporter: ExportAccount }) {
  const headingId = useId();
  return (
    <section className={styles.section} aria-labelledby={headingId}>
      <h2 className={styles.title} id={headingId}>
        {MESSAGES.dataTitle}
      </h2>
      <p className={styles.body}>{MESSAGES.dataBody}</p>
      <ExportControl exporter={exporter} idleLabel={MESSAGES.download} block />
    </section>
  );
}
