import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import styles from "./Sections.module.css";

export interface SectionHeaderProps {
  name: string;
  notes: string;
  index: number;
  count: number;
  /** The id the surrounding `<section>` is labelled by: it sits on the visible name, so the region reads "Main". */
  headingId: string;
  /** The first problem on this section (client or server), already worded; referenced from the name button. */
  error: string | null;
  errorId: string;
  registerMain: (element: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDelete: () => void;
}

/** A section's header in the editor (Spec 10.3 AC14, AC16, AC17): name → section sheet, the note in full, Options. */
export function SectionHeader(props: SectionHeaderProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const reasonId = useId();
  const first = props.index === 0;
  const last = props.index === props.count - 1;
  const upReason = `${reasonId}-up`;
  const downReason = `${reasonId}-down`;
  return (
    <div className={styles.header}>
      <div className={styles.titleRow}>
        <h2 className={styles.heading}>
          <button
            type="button"
            ref={props.registerMain}
            className={styles.nameButton}
            aria-label={`Edit section ${props.name}`}
            {...(props.error ? { "aria-describedby": props.errorId } : {})}
            onClick={props.onOpen}
          >
            <span id={props.headingId}>{props.name}</span>
          </button>
        </h2>
        <Button
          variant="secondary"
          aria-expanded={optionsOpen}
          aria-label={`Options for section ${props.name}`}
          onClick={() => setOptionsOpen((open) => !open)}
        >
          Options
        </Button>
      </div>
      {props.notes.trim() === "" ? null : <p className={styles.notes}>{props.notes}</p>}
      {props.error ? (
        <p id={props.errorId} className={styles.reason}>
          {props.error}
        </p>
      ) : null}
      {optionsOpen ? (
        <div className={styles.options}>
          <Button variant="secondary" aria-label={`Move ${props.name} up`} disabled={first} {...(first ? { "aria-describedby": upReason } : {})} onClick={props.onMoveUp}>
            Move up
          </Button>
          {first ? <p id={upReason} className={styles.reason}>This is the first section</p> : null}
          <Button variant="secondary" aria-label={`Move ${props.name} down`} disabled={last} {...(last ? { "aria-describedby": downReason } : {})} onClick={props.onMoveDown}>
            Move down
          </Button>
          {last ? <p id={downReason} className={styles.reason}>This is the last section</p> : null}
          <Button variant="danger" aria-label={`Delete section ${props.name}`} onClick={props.onDelete}>
            Delete section
          </Button>
        </div>
      ) : null}
    </div>
  );
}
