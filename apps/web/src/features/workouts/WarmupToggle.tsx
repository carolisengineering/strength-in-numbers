import { Button } from "../../ui/Button";
import { CheckIcon } from "../../ui/icons";
import styles from "./WarmupToggle.module.css";

/**
 * Spec 17.7 AC13: one tap makes the draft a warm-up, another makes it working again. Pressed exactly when the draft's
 * type is warm-up (D8: Drop and Failure live under More), filled teal and checked, never by color alone. Its name
 * starts with its visible text and names the exercise.
 */
export function WarmupToggle({ exerciseName, pressed, onToggle }: { exerciseName: string; pressed: boolean; onToggle: () => void }) {
  return (
    <Button
      variant="secondary"
      className={pressed ? `${styles.toggle} ${styles.pressed}` : styles.toggle}
      aria-pressed={pressed}
      aria-label={`Warm-up for ${exerciseName}`}
      onClick={onToggle}
    >
      {pressed ? <CheckIcon /> : null}
      Warm-up
    </Button>
  );
}
