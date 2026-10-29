import { useState, type Ref } from "react";

import { Button } from "../../../ui/Button";
import { PlaceholderSheet } from "../mapping/PlaceholderSheet";
import { CHOOSE_MARKERS, MARKERS_NEEDED, MARKERS_TITLE, SKIP } from "./messages";
import styles from "./ImportScreen.module.css";

/**
 * Spec 20.1 AC8: Hevy's Warmup / workout exercises are section markers the mapping lacks. 20.0's sheet chooses them
 * (mounted only while open: it reads Hevy's template list, already cached by the read); closing it lets the flow
 * decide again, so a saved choice moves on and a dismissed one comes back here. **Skip** imports them as names.
 */
export function MarkersStep({ onDone, onSkip, headingRef }: { onDone: () => void; onSkip: () => void; headingRef: Ref<HTMLHeadingElement> }) {
  const [open, setOpen] = useState(false);
  return (
    <section className={styles.step} aria-labelledby="hevy-import-step">
      <h2 className={styles.stepTitle} id="hevy-import-step" ref={headingRef} tabIndex={-1}>
        {MARKERS_TITLE}
      </h2>
      <p className={styles.text}>{MARKERS_NEEDED}</p>
      <div className={styles.actions}>
        <Button onClick={() => setOpen(true)}>{CHOOSE_MARKERS}</Button>
        <Button variant="secondary" onClick={onSkip}>
          {SKIP}
        </Button>
      </div>
      {open ? (
        <PlaceholderSheet
          open
          onClose={() => {
            setOpen(false);
            onDone();
          }}
        />
      ) : null}
    </section>
  );
}
