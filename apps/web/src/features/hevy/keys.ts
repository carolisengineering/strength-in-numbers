/** Spec 20.0: the only place the Hevy query keys are written. No key ever contains the Hevy API key. */
export const HEVY_KEYS = {
  status: ["hevy", "status"] as const,
  user: ["hevy", "user"] as const,
};
