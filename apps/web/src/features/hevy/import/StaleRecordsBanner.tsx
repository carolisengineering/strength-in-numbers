import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Button } from "../../../ui/Button";
import { applyImportedCaches } from "../../records/cache";
import { useHevyStatus } from "../useHevyStatus";
import { finishImport } from "./finishImport";
import { useHevyImportClient } from "./hevyImportClient";
import { FINISH_FAILED, FINISH_LAST_STEP, FINISHING, RECORDS_UPDATED, STALE_RECORDS, TRY_AGAIN } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC2 / AC22: while the status says the records are stale, offer the finish step. One component, shown on
 * the import's preflight and on the Hevy screen. It goes through `finishImport`, so it waits for any batch still in
 * flight on this page; success refreshes what the import changed. A finish answering `recomputed: false` is done.
 */
export function StaleRecordsBanner() {
  const status = useHevyStatus();
  const client = useHevyImportClient();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "busy" | "failed" | "done">("idle");

  const finish = async () => {
    if (phase === "busy") return;
    setPhase("busy");
    if ((await finishImport(client)) === "failed") return setPhase("failed");
    setPhase("done");
    applyImportedCaches(queryClient);
  };

  const stale = status.data?.recordsStale === true;
  if (!stale && phase !== "done") return null;
  if (!stale && phase === "done") {
    return (
      <p className={styles.status} role="status">
        {RECORDS_UPDATED}
      </p>
    );
  }
  return (
    <section className={styles.card} aria-label={STALE_RECORDS}>
      <p className={styles.text}>{phase === "failed" ? FINISH_FAILED : STALE_RECORDS}</p>
      <div className={styles.actions}>
        <Button variant="secondary" busy={phase === "busy"} onClick={() => void finish()}>
          {phase === "busy" ? FINISHING : phase === "failed" ? TRY_AGAIN : FINISH_LAST_STEP}
        </Button>
      </div>
    </section>
  );
}
