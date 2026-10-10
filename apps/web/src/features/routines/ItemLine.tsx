import styles from "./ItemLine.module.css";
import { UNAVAILABLE } from "./validateDraft";

export interface ItemLineProps {
  name: string;
  line: string;
  notes: string | null;
  position: "none" | "first" | "middle" | "last";
  unavailable: boolean;
}

/** The read-only body of a routine row: name, target line, notes, and the decorative superset bracket. */
export function ItemLine({ name, line, notes, position, unavailable }: ItemLineProps) {
  return (
    <>
      {position === "none" ? null : <span className={`${styles.bracket} ${styles[position]}`} aria-hidden="true" />}
      <span className={styles.text}>
        <span className={styles.name}>{name}</span>
        {line === "" ? null : <span className={styles.line}>{line}</span>}
        {unavailable ? <span className={styles.unavailable}>{UNAVAILABLE}</span> : null}
        {notes ? <span className={styles.notes}>{notes}</span> : null}
      </span>
    </>
  );
}
