import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { WorkoutDetail, WorkoutSection } from "@sin/core";
import { WORKOUT_KEYS, useEditWorkoutClient } from "../queries";
import type { SectionMutations } from "../sections/sectionMutations";
import {
  EDIT_MUTATION_KEY,
  cancelDetailReads,
  editSucceeded,
  ignoreNotFound,
  refetchIfInterrupted,
  writeDetail,
} from "./useEditMutations";

/** A section response is the whole truth for its row (Spec 10.6 D11): replace or append it, then keep position order. */
function withSection(detail: WorkoutDetail, section: WorkoutSection): WorkoutDetail {
  const others = detail.sections.filter((s) => s.id !== section.id);
  return { ...detail, sections: [...others, section].sort((a, b) => a.position - b.position) };
}

/**
 * Spec 10.6 AC18, AC19, AC21 — the edit screen's section writes, the same shape as the live hook but on
 * Spec 18.0's terms: the plain REST client, `EDIT_MUTATION_KEY`, pessimistic, never retried. Create and
 * update write the returned section into the detail (cancelling a read in flight first); remove and move
 * change other rows, so they re-read the detail and resolve only once it has landed. Every success calls
 * `editSucceeded` (one `workout_edit` event, then History / Progress / records refresh). All cache work is
 * in the hook-level `onSuccess`, so it still lands if the screen unmounts mid-request.
 */
export function useEditSectionMutations(workoutId: string): SectionMutations {
  const client = useEditWorkoutClient();
  const queryClient = useQueryClient();
  const base = { mutationKey: EDIT_MUTATION_KEY, networkMode: "always", retry: false } as const;
  const writeThrough = {
    onMutate: () => cancelDetailReads(queryClient, workoutId),
    onSettled: (_d: unknown, _e: unknown, _v: unknown, context: { interrupted: boolean } | undefined) =>
      refetchIfInterrupted(queryClient, workoutId, context),
  };
  const reread = () => queryClient.invalidateQueries({ queryKey: WORKOUT_KEYS.detail(workoutId) });

  const add = useMutation({
    ...base,
    ...writeThrough,
    mutationFn: (body: { name: string; notes?: string }) => client.addSection(workoutId, body),
    onSuccess: (section: WorkoutSection) => {
      writeDetail(queryClient, workoutId, (d) => withSection(d, section));
      editSucceeded(queryClient, "section_added");
    },
  });
  const update = useMutation({
    ...base,
    ...writeThrough,
    mutationFn: ({ id, body }: { id: string; body: { name?: string; notes?: string | null } }) => client.updateSection(id, body),
    onSuccess: (section: WorkoutSection) => {
      writeDetail(queryClient, workoutId, (d) => withSection(d, section));
      editSucceeded(queryClient, "section_changed");
    },
  });
  const remove = useMutation({
    ...base,
    // A repeat of an already-applied remove answers 404: what was asked is done.
    mutationFn: ({ id }: { id: string; exerciseCount: number }) => ignoreNotFound(() => client.removeSection(id)),
    onSuccess: () => {
      editSucceeded(queryClient, "section_removed");
      return reread();
    },
  });
  const setSection = useMutation({
    ...base,
    mutationFn: ({ exerciseId, sectionId }: { exerciseId: string; sectionId: string | null }) =>
      client.setExerciseSection(exerciseId, sectionId),
    onSuccess: () => {
      editSucceeded(queryClient, "exercise_sectioned");
      return reread();
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
