import styles from "./WorkoutText.module.css";

/**
 * A workout's own title or notes (Spec 18.0 AC51), shared by the summary and the edit screen's Details panel so the
 * rules live in one place: React text children only (no markup, markdown or links), notes keep their line breaks,
 * and a long unbroken string wraps instead of scrolling the page sideways.
 */
export function WorkoutText({ text, variant }: { text: string; variant: "title" | "notes" }) {
  return <p className={styles[variant]}>{text}</p>;
}

/**
 * Minor 543: whether the workout has a title of its own (not null, not blank). The summary's title line and its
 * smaller "Workout summary" h1 both read this one predicate, so they never disagree.
 */
export function hasOwnTitle(workout: { readonly title: string | null }): boolean {
  return workout.title !== null && workout.title.trim() !== "";
}
