import { useId, useState } from "react";
import { Button } from "../../ui/Button";
import styles from "./RoutineNotePanel.module.css";

/**
 * The routine's own note at the top of the session (Spec 10.3 AC25, D9). Expanded when the screen mounts; Hide
 * collapses it to one line. The open flag is component state on purpose: nothing about it is stored in the browser.
 */
export function RoutineNotePanel({ name, notes }: { name: string | null; notes: string }) {
  const [open, setOpen] = useState(true);
  const titleId = useId();
  const bodyId = useId();
  return (
    <section className={styles.panel} aria-labelledby={titleId}>
      <div className={styles.head}>
        <h2 className={styles.title} id={titleId}>
          {name === null ? "Routine note" : `Routine note · ${name}`}
        </h2>
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Hide routine note" : "Show routine note"}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? "Hide" : "Show"}
        </Button>
      </div>
      {open ? (
        <p className={styles.body} id={bodyId}>
          {notes}
        </p>
      ) : null}
    </section>
  );
}
