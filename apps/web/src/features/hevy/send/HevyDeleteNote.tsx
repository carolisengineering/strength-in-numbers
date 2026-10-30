import { HEVY_SEND_COPY } from "./messages";
import { useHevyLink } from "./useHevyLink";

/**
 * Spec 20.2 AC18: inside a Delete dialog, says the Hevy copy stays. Reads the link only while the dialog is open (and,
 * through `useHevyLink`, only for the owner); renders nothing for a non-owner, a workout not in Hevy, a pending read
 * or a failed one.
 */
export function HevyDeleteNote({ workoutId, open }: { workoutId: string; open: boolean }) {
  const link = useHevyLink(workoutId, { enabled: open });
  if (!open || typeof link.data?.hevyWorkoutId !== "string") return null;
  return <p>{HEVY_SEND_COPY.deleteNote}</p>;
}
