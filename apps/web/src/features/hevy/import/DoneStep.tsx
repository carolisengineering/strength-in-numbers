import { useEffect, useState, type Ref } from "react";
import { Link } from "react-router";

import { Button } from "../../../ui/Button";
import { HEVY_PATH } from "../paths";
import type { ImportState } from "./importSession";
import { BACK_TO_HEVY, DONE_TITLE, FINISH_FAILED, FINISHING, RECORDS_UPDATED, TRY_AGAIN, VIEW_HISTORY } from "./messages";
import styles from "./ImportScreen.module.css";

const HISTORY_PATH = "/app/history";

/** Spec 20.1 AC22, AC25, §5.7: the done screen. */
export function DoneStep({ state, onRetryFinish, headingRef }: { state: ImportState; onRetryFinish: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  // AC29: the live region is empty at first paint.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const finish = state.finish;
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {DONE_TITLE}
      </h2>
      <p className={styles.status} role="status">
        {!mounted ? "" : finish === "ok" ? RECORDS_UPDATED : finish === "running" ? FINISHING : ""}
      </p>
      {finish === "failed" ? (
        <div className={styles.card} role="alert">
          <p className={styles.failure}>{FINISH_FAILED}</p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onRetryFinish}>
              {TRY_AGAIN}
            </Button>
          </div>
        </div>
      ) : null}
      <div className={styles.actions}>
        <Link className={styles.link} to={HISTORY_PATH}>
          {VIEW_HISTORY}
        </Link>
        <Link className={styles.link} to={HEVY_PATH}>
          {BACK_TO_HEVY}
        </Link>
      </div>
    </section>
  );
}
