import { useState } from "react";
import { Button } from "../../ui/Button";
import { ItemLine } from "./ItemLine";
import { UNAVAILABLE } from "./validateDraft";
import styles from "./RoutineEditor.module.css";

export interface EditorRowProps {
  name: string;
  line: string;
  notes: string | null;
  position: "none" | "first" | "middle" | "last";
  accessibleName: string;
  unavailable: boolean;
  /** Per-row errors (AC31), already worded; referenced from the main control. */
  error: string | null;
  errorId: string;
  isFirst: boolean;
  isLast: boolean;
  registerMain: (element: HTMLButtonElement | null) => void;
  onOpen: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
}

/** One editor row (Spec 10.0 AC27): main control → item sheet; Options → Move up / Move down / Remove (06.1 pattern). */
export function EditorRow(props: EditorRowProps) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  // An unavailable row already shows its marker; any other error on it still needs its own line.
  const shownError = props.error !== null && !(props.unavailable && props.error === UNAVAILABLE) ? props.error : null;
  return (
    <div className={styles.row}>
      <button
        type="button"
        ref={props.registerMain}
        className={styles.main}
        aria-label={props.accessibleName}
        {...(shownError ? { "aria-describedby": props.errorId } : {})}
        onClick={props.onOpen}
      >
        <ItemLine name={props.name} line={props.line} notes={props.notes} position={props.position} unavailable={props.unavailable} />
      </button>
      {shownError ? (
        <p id={props.errorId} className={styles.reason}>
          {shownError}
        </p>
      ) : null}
      <Button variant="secondary" aria-expanded={optionsOpen} onClick={() => setOptionsOpen((open) => !open)}>
        Options
      </Button>
      {optionsOpen ? (
        <div className={styles.options}>
          <Button variant="secondary" disabled={props.isFirst} onClick={props.onMoveUp}>
            Move up
          </Button>
          <Button variant="secondary" disabled={props.isLast} onClick={props.onMoveDown}>
            Move down
          </Button>
          <Button variant="danger" onClick={props.onRemove}>
            Remove
          </Button>
        </div>
      ) : null}
    </div>
  );
}
