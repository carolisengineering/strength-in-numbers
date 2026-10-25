import { createContext, useContext } from "react";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import type { WorkoutDetail } from "@sin/core";
import type { WorkoutClient } from "./workoutClient";

export const WORKOUT_KEYS = {
  active: ["workouts", "active"] as const,
  detail: (id: string) => ["workouts", "detail", id] as const,
};

/**
 * The seam Spec 06.2 replaces: every read and write goes through whatever client is provided here.
 * `WorkoutClientProvider` supplies the REST implementation; tests inject a fake.
 */
export const WorkoutClientContext = createContext<WorkoutClient | null>(null);

export function useWorkoutClient(): WorkoutClient {
  const client = useContext(WorkoutClientContext);
  if (client === null) throw new Error("useWorkoutClient() must be used inside <WorkoutClientProvider>");
  return client;
}

/**
 * The in-progress workout, or `null` when there is none (a 404 is data, not an error).
 * Refetches on mount and on window focus (a phone coming back from another app) — overriding the
 * app-wide `refetchOnWindowFocus: false`. `retry: false`: the error notice's button is the retry.
 */
export function useActiveWorkout(): UseQueryResult<WorkoutDetail | null> {
  const client = useWorkoutClient();
  return useQuery({
    queryKey: WORKOUT_KEYS.active,
    queryFn: () => client.getActive(),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
  });
}

/**
 * Spec 18.0 D5: the plain REST client, for edit mode. Edits are pessimistic and never queued, so they
 * must not go through the queued client (whose REST fall-through for a non-active workout is an accident
 * of its `cached()` check, not a rule).
 */
export const EditWorkoutClientContext = createContext<WorkoutClient | null>(null);

export function useEditWorkoutClient(): WorkoutClient {
  const client = useContext(EditWorkoutClientContext);
  if (client === null) throw new Error("useEditWorkoutClient() must be used inside <WorkoutClientProvider>");
  return client;
}

/**
 * The edit screen's workout (Spec 18.0 §6.1): the summary's key, but always re-read on mount and on
 * focus so an edit starts from the server's truth. `retry: false`: the error notice's button is the retry.
 */
export function useEditableWorkout(id: string, { enabled = true }: { enabled?: boolean } = {}): UseQueryResult<WorkoutDetail> {
  const client = useEditWorkoutClient();
  return useQuery({
    queryKey: WORKOUT_KEYS.detail(id),
    queryFn: () => client.getById(id),
    // #160: off while the screen deletes the workout, so nothing re-reads it on the way out.
    enabled,
    // Stale at once, so a focus re-reads it (the app default staleTime would skip a focus within 30 s).
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    retry: false,
    // Spec 18.0 AC15: an offline device fails the read at once (so "Couldn't refresh" shows) instead of pausing it.
    networkMode: "always",
  });
}

export function useWorkoutDetail(id: string): UseQueryResult<WorkoutDetail> {
  const client = useWorkoutClient();
  return useQuery({
    queryKey: WORKOUT_KEYS.detail(id),
    queryFn: () => client.getById(id),
    retry: false,
  });
}
