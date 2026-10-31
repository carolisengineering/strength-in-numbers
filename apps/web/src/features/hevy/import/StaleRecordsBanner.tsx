import { useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { Button } from "../../../ui/Button";
import { applyImportedCaches } from "../../records/cache";
import { useHevyStatus } from "../useHevyStatus";
import { finishImport } from "./finishImport";
import { useHevyImportClient } from "./hevyImportClient";
import { FINISH_FAILED, FINISH_LAST_STEP, FINISHING, RECORDS_UPDATED, STALE_RECORDS, TRY_AGAIN } from "./messages";
import hidden from "../../../ui/VisuallyHidden.module.css";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC2 / AC22: while the status says the records are stale, offer the finish step. One component, shown on
 * the import's preflight and on the Hevy screen. It goes through `finishImport`, so it waits for any batch still in
 * flight on this page; success refreshes what the import changed. A finish answering `recomputed: false` is done.
 *
 * Minor 241: "Records updated." goes into one polite status line that is always there (empty until a finish
 * succeeds, and visually hidden while empty so it adds no gap to the screen's column), so it is announced. After a
 * success the card stays hidden until the status has been read again since the finish; from then on `recordsStale`
 * alone decides (another run may have made the records stale again).
 */
export function StaleRecordsBanner() {
  const status = useHevyStatus();
  const client = useHevyImportClient();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "busy" | "failed" | "done">("idle");
  const finishedAt = useRef(0);

  const finish = async () => {
    if (phase === "busy") return;
    setPhase("busy");
    if ((await finishImport(client)) === "failed") return setPhase("failed");
    finishedAt.current = Date.now();
    setPhase("done");
    applyImportedCaches(queryClient);
  };

  const stale = status.data?.recordsStale === true;
  const awaitingReread = phase === "done" && status.dataUpdatedAt <= finishedAt.current;
  const showCard = stale && !awaitingReread;
  const line = phase === "done" && !showCard ? RECORDS_UPDATED : "";
  return (
    <>
      <p className={line === "" ? `${styles.status} ${hidden.hidden}` : styles.status} role="status">
        {line}
      </p>
      {showCard ? (
        <section className={styles.card} aria-label={STALE_RECORDS}>
          <p className={styles.text}>{phase === "failed" ? FINISH_FAILED : STALE_RECORDS}</p>
          <div className={styles.actions}>
            <Button variant="secondary" busy={phase === "busy"} onClick={() => void finish()}>
              {phase === "busy" ? FINISHING : phase === "failed" ? TRY_AGAIN : FINISH_LAST_STEP}
            </Button>
          </div>
        </section>
      ) : null}
    </>
  );
}
