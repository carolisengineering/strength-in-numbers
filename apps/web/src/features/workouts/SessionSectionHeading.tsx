import { useId, type ReactNode } from "react";
import styles from "./SessionSectionHeading.module.css";

export interface SessionSectionHeadingProps {
  id: string;
  heading: string;
  notes: string | null;
}

/** The heading and, directly beneath it, the section's note — full text, wrapped (Spec 10.3 AC24). */
export function SessionSectionHeading({ id, heading, notes }: SessionSectionHeadingProps) {
  return (
    <div className={styles.heading}>
      <h2 className={styles.name} id={id}>
        {heading}
      </h2>
      {notes ? <p className={styles.notes}>{notes}</p> : null}
    </div>
  );
}

/** A labeled region: heading → note → cards, which is also the DOM (and so the reading) order (D10). */
export function SessionSection({ heading, notes, children }: { heading: string; notes: string | null; children: ReactNode }) {
  const id = useId();
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SessionSectionHeading id={id} heading={heading} notes={notes} />
      {children}
    </section>
  );
}
