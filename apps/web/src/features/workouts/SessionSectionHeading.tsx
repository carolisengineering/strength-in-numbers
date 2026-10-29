import { useId, type ReactNode } from "react";
import { Button } from "../../ui/Button";
import { SECTION_COPY, editLabel } from "./sections/sectionCopy";
import styles from "./SessionSectionHeading.module.css";

export interface SessionSectionHeadingProps {
  id: string;
  heading: string;
  notes: string | null;
  /** Spec 10.6 AC1: renders the Edit button. Only the live and edit screens pass it — never the summary. */
  onEdit?: () => void;
  editRef?: (node: HTMLButtonElement | null) => void;
}

/** The heading and, directly beneath it, the section's note — full text, wrapped (Spec 10.3 AC24). */
export function SessionSectionHeading({ id, heading, notes, onEdit, editRef }: SessionSectionHeadingProps) {
  return (
    <div className={styles.heading}>
      {onEdit ? (
        <div className={styles.row}>
          <h2 className={styles.name} id={id}>
            {heading}
          </h2>
          <Button variant="secondary" aria-label={editLabel(heading)} onClick={onEdit} ref={editRef}>
            {SECTION_COPY.edit}
          </Button>
        </div>
      ) : (
        <h2 className={styles.name} id={id}>
          {heading}
        </h2>
      )}
      {notes ? <p className={styles.notes}>{notes}</p> : null}
    </div>
  );
}

export interface SessionSectionProps {
  heading: string;
  notes: string | null;
  children: ReactNode;
  onEdit?: () => void;
  editRef?: (node: HTMLButtonElement | null) => void;
  /** Spec 10.6 AC2: shown in place of cards when `empty`. */
  emptyText?: string;
  /** The segment holds no exercises (minor 64: the caller knows from its rows; children are never inspected). */
  empty?: boolean;
}

/** A labeled region: heading → note → cards, which is also the DOM (and so the reading) order (D10). */
export function SessionSection({ heading, notes, children, onEdit, editRef, emptyText, empty = false }: SessionSectionProps) {
  const id = useId();
  const showEmpty = empty && emptyText !== undefined;
  return (
    <section className={styles.section} aria-labelledby={id}>
      <SessionSectionHeading id={id} heading={heading} notes={notes} onEdit={onEdit} editRef={editRef} />
      {showEmpty ? <p className={styles.empty}>{emptyText}</p> : children}
    </section>
  );
}
