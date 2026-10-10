import { Button } from "../../ui/Button";
import styles from "./RoutineEditor.module.css";

export interface LinkToggleProps {
  id: string;
  above: string;
  below: string;
  linked: boolean;
  /** Why linking is refused (the 8-member cap); `null` when it is allowed. */
  refusal: string | null;
  onToggle: () => void;
}

/** "Superset with next" between two neighbours (Spec 10.0 AC29, D3). */
export function LinkToggle({ id, above, below, linked, refusal, onToggle }: LinkToggleProps) {
  const reasonId = `${id}-reason`;
  const blocked = !linked && refusal !== null;
  return (
    <div className={styles.link}>
      <Button
        variant="secondary"
        aria-pressed={linked}
        aria-label={`Superset ${above} with ${below}`}
        disabled={blocked}
        {...(blocked ? { "aria-describedby": reasonId } : {})}
        onClick={onToggle}
      >
        {linked ? "Superset ✓" : "Superset with next"}
      </Button>
      {blocked ? (
        <p id={reasonId} className={styles.reason}>
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
