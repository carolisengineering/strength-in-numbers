import { Button } from "../../ui/Button";
import styles from "./ChoiceGroup.module.css";

/** A named group of `aria-pressed` buttons — the metric control and the range chips (Spec 08.1 AC14, AC15). */
export function ChoiceGroup<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | undefined;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={styles.group}>
      {options.map((o) => (
        <Button
          key={o.value}
          variant="secondary"
          aria-pressed={o.value === value}
          className={o.value === value ? styles.pressed : undefined}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
