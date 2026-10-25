import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { WorkoutDetail } from "@sin/core";

/**
 * Spec 10.6 §6.4 — a section move remounts its card under another <section>; once its heading is registered,
 * focus and show it. Shared by the live and the edit screen, which each pass their heading map and a read of
 * the workout as cached.
 *
 * #157: the move's write resolves only after its re-read, so the cache already says whether the move shows. If it
 * does not (the re-read failed, or was canceled three times), nothing is armed: a refetch landing much later must
 * never pull focus to that card. An armed reveal fires only once the card shows under the move's section.
 */
export function useRevealMoved(
  workout: Pick<WorkoutDetail, "exercises">,
  segments: unknown,
  headingRefs: RefObject<Map<string, HTMLHeadingElement>>,
  cached: () => WorkoutDetail | null | undefined,
): (exerciseId: string, sectionId: string | null) => void {
  const target = useRef<{ exerciseId: string; sectionId: string | null } | null>(null);
  useEffect(() => {
    const moved = target.current;
    if (moved === null) return;
    const exercise = workout.exercises.find((e) => e.id === moved.exerciseId);
    if (exercise === undefined) {
      target.current = null;
      return;
    }
    if (exercise.sectionId !== moved.sectionId) return;
    const node = headingRefs.current.get(moved.exerciseId);
    if (node === undefined) return;
    target.current = null;
    node.focus();
    node.scrollIntoView?.({ block: "nearest" });
  }, [segments, workout.exercises, headingRefs]);

  return useCallback(
    (exerciseId: string, sectionId: string | null) => {
      const shown = cached()?.exercises.find((e) => e.id === exerciseId)?.sectionId === sectionId;
      target.current = shown ? { exerciseId, sectionId } : null;
    },
    [cached],
  );
}
