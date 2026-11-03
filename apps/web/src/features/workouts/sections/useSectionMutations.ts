import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { CreateWorkoutSection, UpdateWorkoutSection } from "@sin/core";
import { track } from "../../../observability/track";
import { WORKOUT_KEYS, useWorkoutClient } from "../queries";
import { rereadUntilLanded } from "../readGuard";
import { ignoreNotFound } from "../../../api";
import type { SectionMutations } from "./sectionMutations";

/**
 * Spec 10.6 AC12, AC15, AC19 — the live screen's section writes: online-only TanStack mutations on the
 * live client (`networkMode: "always"`, `retry: false`, no outbox op). Each hook-level `onSuccess`
 * tracks its event, then returns the active workout's re-read, so `mutateAsync` resolves only once an
 * answer has landed (asked again if a set write canceled it, #158) and the screen changes only from the server's answer.
 */
/** Spec 10.7 AC24: once per timer change, the format's enum value only (`none` for a removal). */
function trackTimerSet(body: CreateWorkoutSection | UpdateWorkoutSection) {
  if (body.timer === undefined) return;
  track("section_timer_set", { format: body.timer === null ? "none" : body.timer.format });
}

export function useSectionMutations(workoutId: string): SectionMutations {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  const refresh = () => rereadUntilLanded(queryClient, WORKOUT_KEYS.active);
  const base = { networkMode: "always", retry: false } as const;

  const add = useMutation({
    ...base,
    mutationFn: (body: CreateWorkoutSection) => client.addSection(workoutId, body),
    onSuccess: (_section, body) => {
      track("section_added");
      trackTimerSet(body);
      return refresh();
    },
  });
  const update = useMutation({
    ...base,
    mutationFn: ({ id, body }: { id: string; body: UpdateWorkoutSection }) => client.updateSection(id, body),
    onSuccess: (_section, { body }) => {
      track("section_edited");
      trackTimerSet(body);
      return refresh();
    },
  });
  const remove = useMutation({
    ...base,
    // A repeat of an already-applied remove answers 404: what was asked is done (AC8).
    mutationFn: ({ id }: { id: string; exerciseCount: number }) => ignoreNotFound(() => client.removeSection(id)),
    onSuccess: (_void, { exerciseCount }) => {
      track("section_removed", { exerciseCount });
      return refresh();
    },
  });
  const setSection = useMutation({
    ...base,
    mutationFn: ({ exerciseId, sectionId }: { exerciseId: string; sectionId: string | null }) =>
      client.setExerciseSection(exerciseId, sectionId),
    onSuccess: () => {
      track("exercise_sectioned");
      return refresh();
    },
  });

  return {
    add: (body) => add.mutateAsync(body),
    update: (id, body) => update.mutateAsync({ id, body }),
    remove: (id, exerciseCount) => remove.mutateAsync({ id, exerciseCount }),
    setSection: (exerciseId, sectionId) => setSection.mutateAsync({ exerciseId, sectionId }),
    pending: add.isPending || update.isPending || remove.isPending || setSection.isPending,
  };
}
