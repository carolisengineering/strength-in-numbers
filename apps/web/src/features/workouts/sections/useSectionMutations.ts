import { useMutation, useQueryClient } from "@tanstack/react-query";
import { track } from "../../../observability/track";
import { WORKOUT_KEYS, useWorkoutClient } from "../queries";
import { rereadUntilLanded } from "../readGuard";
import { ignoreNotFound } from "../useWorkoutMutations";
import type { SectionMutations } from "./sectionMutations";

/**
 * Spec 10.6 AC12, AC15, AC19 — the live screen's section writes: online-only TanStack mutations on the
 * live client (`networkMode: "always"`, `retry: false`, no outbox op). Each hook-level `onSuccess`
 * tracks its event, then returns the active workout's re-read, so `mutateAsync` resolves only once an
 * answer has landed (asked again if a set write canceled it, #158) and the screen changes only from the server's answer.
 */
export function useSectionMutations(workoutId: string): SectionMutations {
  const client = useWorkoutClient();
  const queryClient = useQueryClient();
  const refresh = () => rereadUntilLanded(queryClient, WORKOUT_KEYS.active);
  const base = { networkMode: "always", retry: false } as const;

  const add = useMutation({
    ...base,
    mutationFn: (body: { name: string; notes?: string }) => client.addSection(workoutId, body),
    onSuccess: () => {
      track("section_added");
      return refresh();
    },
  });
  const update = useMutation({
    ...base,
    mutationFn: ({ id, body }: { id: string; body: { name?: string; notes?: string | null } }) => client.updateSection(id, body),
    onSuccess: () => {
      track("section_edited");
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
