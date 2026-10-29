import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { Button } from "../../../ui/Button";
import { HEVY_KEYS } from "../keys";
import { useHevyStatus } from "../useHevyStatus";
import { useHevyImportClient } from "./hevyImportClient";
import { FINISH_FAILED, FINISH_LAST_STEP, FINISHING, RECORDS_UPDATED, STALE_RECORDS } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC2 / AC22: while the status says the records are stale, offer the finish step. One component, shown on
 * the import's preflight and (Phase B) on the Hevy screen. A finish answering `recomputed: false` is still done.
 */
export function StaleRecordsBanner() {
  const status = useHevyStatus();
  const client = useHevyImportClient();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "busy" | "failed" | "done">("idle");

  const finish = async () => {
    if (phase === "busy") return;
    setPhase("busy");
    try {
      await client.finish();
      setPhase("done");
      await queryClient.invalidateQueries({ queryKey: HEVY_KEYS.statusAll });
    } catch (err) {
      const quiet = err instanceof ApiError && (err.isNetworkError || (err.status >= 400 && err.status < 500));
      if (!quiet) reportError(err, { source: "hevy-import", op: "finish" });
      setPhase("failed");
    }
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
          {phase === "busy" ? FINISHING : FINISH_LAST_STEP}
        </Button>
      </div>
    </section>
  );
}
