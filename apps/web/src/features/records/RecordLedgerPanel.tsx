import { Fragment, useId, useState } from "react";

import { Button } from "../../ui/Button";
import { VisuallyHidden } from "../../ui/VisuallyHidden";
import { collapsedCount, EST_1RM_EXPLAINED, LEDGER_COLLAPSE_OVER, type LedgerLift } from "./recordLedger";
import styles from "./RecordLedgerPanel.module.css";

/**
 * Spec 17.6 AC2–AC4, AC8, AC9, AC11, AC17: the summary's one brass panel. A `section` named by its heading, a list of
 * lifts, each a name over its ledger lines (label, old → new, gain) and where the set came from. Dumb: every decision is
 * `buildRecordLedger`'s. Each line is one sentence for a screen reader; the visible figure is `aria-hidden`. Static.
 */
export function RecordLedgerPanel({ heading, lifts }: { heading: string; lifts: readonly LedgerLift[] }) {
  const headingId = useId();
  // AC11: local and never stored; a data refresh never resets it.
  const [expanded, setExpanded] = useState(false);
  const shown = lifts.slice(0, collapsedCount(lifts.length, expanded));
  return (
    <section className={styles.panel} aria-labelledby={headingId}>
      <h2 id={headingId} className={styles.heading}>
        {heading}
      </h2>
      <ul className={styles.lifts}>
        {shown.map((lift) => (
          <li key={lift.key} className={styles.lift}>
            <h3 className={styles.name}>{lift.name}</h3>
            {lift.rows.map((row) => (
              <Fragment key={row.type}>
                <p className={styles.row}>
                  <VisuallyHidden>{row.spoken}</VisuallyHidden>
                  <span className={styles.line} aria-hidden="true">
                    <span className={styles.label}>{row.label}</span>
                    <span className={styles.figure}>
                      {row.oldText === null ? null : (
                        <>
                          <span className={styles.old}>{row.oldText}</span>
                          <span className={styles.old}>→</span>
                        </>
                      )}
                      <span className={styles.new}>{row.newText}</span>
                      {row.gainText === null ? null : <span className={styles.gain}>{row.gainText}</span>}
                    </span>
                  </span>
                </p>
                {row.sourceText === null ? null : <p className={styles.source}>{row.sourceText}</p>}
              </Fragment>
            ))}
            {lift.sourceText === null ? null : <p className={styles.source}>{lift.sourceText}</p>}
          </li>
        ))}
      </ul>
      {lifts.length > LEDGER_COLLAPSE_OVER ? (
        <Button variant="secondary" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
          {expanded ? "Show fewer" : `Show all ${lifts.length} lifts`}
        </Button>
      ) : null}
      {shown.some((lift) => lift.hasEstimate) ? <p className={styles.explain}>{EST_1RM_EXPLAINED}</p> : null}
    </section>
  );
}
