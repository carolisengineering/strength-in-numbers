import type { WorkoutSection } from "@sin/core";
import { SECTION_COPY } from "./sectionCopy";
import styles from "./SectionPicker.module.css";

export interface SectionPickerProps {
  exerciseId: string;
  value: string | null;
  sections: readonly WorkoutSection[];
  /** The exercise sits in a linked superset run (AC11). */
  linked: boolean;
  disabled: boolean;
  onChange(sectionId: string | null): void;
}

/**
 * Spec 10.6 AC9 / AC11 — the Section select in an exercise's Options. Controlled by the cached
 * `sectionId`, so a failed move visibly reverts; re-choosing the current value sends nothing.
 */
export function SectionPicker({ exerciseId, value, sections, linked, disabled, onChange }: SectionPickerProps) {
  if (sections.length === 0) return null;
  const id = `section-picker-${exerciseId}`;
  const hintId = `${id}-hint`;
  const ordered = [...sections].sort((a, b) => a.position - b.position);
  return (
    <div className={styles.picker}>
      <label className={styles.label} htmlFor={id}>
        {SECTION_COPY.sectionLabel}
      </label>
      <select
        id={id}
        className={styles.select}
        value={value ?? ""}
        disabled={disabled}
        aria-describedby={linked ? hintId : undefined}
        onChange={(e) => {
          const next = e.target.value === "" ? null : e.target.value;
          if (next !== value) onChange(next);
        }}
      >
        <option value="">{SECTION_COPY.noSection}</option>
        {ordered.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {linked ? (
        <p id={hintId} className={styles.hint}>
          {SECTION_COPY.supersetHint}
        </p>
      ) : null}
    </div>
  );
}
