import { sectionForNewExercise, type WorkoutSection } from "@sin/core";
import { SECTION_COPY } from "./sectionCopy";
import styles from "./NewExercisesLine.module.css";

/**
 * Spec 10.6 AC4 — "New exercises go into {name}." iff the next plain Add exercise lands in a section
 * (Spec 09.4 C4: the last section, only if it was added during the workout). The one web caller of
 * `sectionForNewExercise`, so the rule has one implementation.
 */
export function NewExercisesLine({ sections }: { sections: readonly WorkoutSection[] }) {
  const target = sectionForNewExercise(sections);
  if (target === null) return null;
  return (
    <p className={styles.line}>
      {SECTION_COPY.lineBefore}
      <strong className={styles.name}>{target.name}</strong>
      {SECTION_COPY.lineAfter}
    </p>
  );
}
