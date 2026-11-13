import { Button } from "../../ui/Button";
import { collapsedCount, LEDGER_COLLAPSE_OVER, type FirstTimeLine } from "./recordLedger";
import { useCollapseToggle } from "./useCollapseToggle";
import styles from "./FirstTimeLines.module.css";

/**
 * Spec 17.6 AC12–AC13 (D1): a first-ever number is a quiet line, outside the panel: muted text, no brass, no tint, not
 * counted. Long lists collapse by the panel's rule (AC11), on their own.
 */
export function FirstTimeLines({ lines }: { lines: readonly FirstTimeLine[] }) {
  const { expanded, toggle, buttonRef } = useCollapseToggle();
  const shown = lines.slice(0, collapsedCount(lines.length, expanded));
  return (
    <div className={styles.firsts}>
      <ul className={styles.lines} aria-label="First time logged">
        {shown.map((line) => (
          <li key={line.key}>{line.text}</li>
        ))}
      </ul>
      {lines.length > LEDGER_COLLAPSE_OVER ? (
        <Button ref={buttonRef} variant="secondary" aria-expanded={expanded} onClick={toggle}>
          {expanded ? "Show fewer" : `Show all ${lines.length} first times`}
        </Button>
      ) : null}
    </div>
  );
}
