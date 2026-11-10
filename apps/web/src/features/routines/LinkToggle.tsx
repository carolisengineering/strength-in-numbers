import { Button } from "../../ui/Button";
import { CheckIcon } from "../../ui/icons";
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
  /**
   * Spec 17.7 AC19: inside a card's Options the toggle names its neighbor's side ("Superset with previous" / "with
   * next"), full width, check beside the text when linked; its name is the text plus the neighbor ("Superset with
   * next: Lateral Raise"). Absent: today's toggle between two cards ("Superset {above} with {below}"), unchanged.
   */
  direction?: "previous" | "next";
}

/** "Superset with next" between two neighbours (Spec 10.0 AC29, D3). */
export function LinkToggle({ id, above, below, linked, refusal, onToggle, disabled = false, direction }: LinkToggleProps) {
  const reasonId = `${id}-reason`;
  const blocked = !linked && refusal !== null;
  if (direction) {
    const text = `Superset with ${direction}`;
    return (
      <div className={`${styles.link} ${styles.linkFlush}`}>
        <Button
          variant="secondary"
          block
          aria-pressed={linked}
          // Spec 17.7 AC23 (WCAG 2.5.3, as 17.1 AC38): the name starts with the visible text, then names the neighbor.
          aria-label={`${text}: ${direction === "previous" ? above : below}`}
          disabled={blocked || disabled}
          {...(blocked ? { "aria-describedby": reasonId } : {})}
          onClick={onToggle}
        >
          {text}
          {linked ? <CheckIcon className={styles.linkCheck} /> : null}
        </Button>
        {blocked ? (
          <p id={reasonId} className={styles.reason}>
            {refusal}
          </p>
        ) : null}
      </div>
    );
  }
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
        {linked ? (
          <>
            Superset
            <CheckIcon className={styles.linkCheck} />
          </>
        ) : (
          "Superset with next"
        )}
      </Button>
      {blocked ? (
        <p id={reasonId} className={styles.reason}>
          {refusal}
        </p>
      ) : null}
    </div>
  );
}
