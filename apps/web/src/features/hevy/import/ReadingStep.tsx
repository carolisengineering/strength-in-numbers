import { useEffect, useState, type Ref } from "react";

import { Button } from "../../../ui/Button";
import { HevyKeyCard } from "../HevyKeyCard";
import { useTemplatesProgress } from "../mapping/templatesProgress";
import { HEVY_COPY } from "../messages";
import type { ImportState } from "./importSession";
import { CANCEL, READ_FAILED, readFailedStage, READING_TITLE, readingLine, TRY_AGAIN } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC3, AC5, §5.2: the reading stage and its failures. The stage line is a polite status, empty at first
 * paint; the templates stage takes its page from the shared template read (`useTemplatesProgress`).
 */
export function ReadingStep({
  state,
  onCancel,
  onRetry,
  headingRef,
}: {
  state: ImportState;
  onCancel: () => void;
  onRetry: () => void;
  headingRef: Ref<HTMLHeadingElement>;
}) {
  const templates = useTemplatesProgress();
  // AC29: the live region is empty at first paint, so its first line is announced.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const failure = state.readError;
  const p = state.progress;
  const live = p?.stage === "templates" && templates !== null ? { ...p, page: templates.page, pageCount: templates.pageCount } : p;
  const line = mounted && failure === null && live ? readingLine(live.stage, live.page, live.pageCount) : "";

  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {READING_TITLE}
      </h2>
      <p className={styles.status} role="status">
        {line}
      </p>
      {failure === null ? (
        <>
          <progress className={styles.progress} aria-hidden="true" max={live && live.pageCount > 0 ? live.pageCount : undefined} value={live && live.pageCount > 0 ? live.page : undefined} />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onCancel}>
              {CANCEL}
            </Button>
          </div>
        </>
      ) : failure.kind === "bad_key" ? (
        <>
          <p className={styles.failure} role="alert">
            {HEVY_COPY.bad_key}
          </p>
          <HevyKeyCard />
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onCancel}>
              {CANCEL}
            </Button>
          </div>
        </>
      ) : failure.kind === "unexpected_reply" ? (
        <>
          <p className={styles.failure} role="alert">
            {HEVY_COPY.unexpected_reply}
          </p>
          <div className={styles.actions}>
            <Button variant="secondary" onClick={onCancel}>
              {CANCEL}
            </Button>
          </div>
        </>
      ) : (
        <>
          <div role="alert">
            <p className={styles.failure}>{failure.cause === "network" ? HEVY_COPY.network : READ_FAILED}</p>
            {failure.cause === "network" ? null : <p className={styles.muted}>{readFailedStage(failure.stage)}</p>}
          </div>
          <div className={styles.actions}>
            <Button onClick={onRetry}>{TRY_AGAIN}</Button>
            <Button variant="secondary" onClick={onCancel}>
              {CANCEL}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}
