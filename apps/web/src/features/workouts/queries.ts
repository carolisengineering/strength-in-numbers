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

export function useWorkoutDetail(id: string): UseQueryResult<WorkoutDetail> {
  const client = useWorkoutClient();
  return useQuery({
    queryKey: WORKOUT_KEYS.detail(id),
    queryFn: () => client.getById(id),
    retry: false,
  });
}
