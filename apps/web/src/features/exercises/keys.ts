/** Query keys for the Exercises tab (Spec 18.2). */
export const EXERCISE_KEYS = {
  usage: ["exercises", "usage"] as const,
  /** Phase B: the routines that use an exercise (the Delete warning). */
  routines: (id: string) => ["exercises", "routines", id] as const,
};
