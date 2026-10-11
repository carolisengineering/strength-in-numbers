import type { RunPosition } from "@sin/core";
import styles from "./SupersetBracket.module.css";

/**
 * The decorative superset bracket (Spec 10.0 §5; shared by the session screens, Spec 10.1 D5): a line down
 * the left of each member, continuous across the run. The parent is `position: relative`. Meaning is
 * carried by the accessible name ("…, superset N, …"), never by this line.
 */
export function SupersetBracket({ position }: { position: RunPosition }) {
  if (position === "none") return null;
  return <span className={`${styles.bracket} ${styles[position]}`} data-bracket={position} aria-hidden="true" />;
}
