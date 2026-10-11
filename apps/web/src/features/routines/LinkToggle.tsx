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
  /** The session latches every toggle while a regroup is in flight (Spec 10.1 AC22). */
  disabled?: boolean;
}

/** "Superset with next" between two neighbours (Spec 10.0 AC29, D3). */
export function LinkToggle({ id, above, below, linked, refusal, onToggle, disabled = false }: LinkToggleProps) {
  const reasonId = `${id}-reason`;
  const blocked = !linked && refusal !== null;
  return (
    <div className={styles.link}>
      <Button
        variant="secondary"
        aria-pressed={linked}
        aria-label={`Superset ${above} with ${below}`}
        disabled={blocked || disabled}
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
