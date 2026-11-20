import { useId } from "react";

import { Button } from "../../ui/Button";
import { collapsedCount, EST_1RM_EXPLAINED, LEDGER_COLLAPSE_OVER, type FirstTimeLine } from "./recordLedger";
import { useCollapseToggle } from "./useCollapseToggle";
import styles from "./FirstTimeLines.module.css";

/**
 * Spec 17.6 AC12–AC13 (D1): a first-ever number is a quiet line, outside the panel: muted text, no brass, no tint, not
 * counted. Long lists collapse by the panel's rule (AC11), on their own. The list has no name: each item already
 * starts "First time logged:" (minor 475). `explain` adds AC9's explanation once under the lines, when a line leads
 * with an est. 1-rep max and the panel doesn't explain it (minor 477).
 */
export function FirstTimeLines({ lines, explain }: { lines: readonly FirstTimeLine[]; explain: boolean }) {
  const { expanded, toggle, buttonRef } = useCollapseToggle();
  // Minor 689: Show all names the list it opens.
  const listId = useId();
  const shown = lines.slice(0, collapsedCount(lines.length, expanded));
  return (
    <div className={styles.firsts}>
      <ul id={listId} className={styles.lines} data-first-times="">
        {shown.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
      {lines.length > LEDGER_COLLAPSE_OVER ? (
        <Button ref={buttonRef} variant="secondary" aria-expanded={expanded} aria-controls={listId} onClick={toggle}>
          {expanded ? "Show fewer" : `Show all ${lines.length} first times`}
        </Button>
      ) : null}
      {explain ? <p className={styles.explain}>{EST_1RM_EXPLAINED}</p> : null}
    </div>
  );
}
