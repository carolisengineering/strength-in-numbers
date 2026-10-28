/** Spec 20.0: the only place the Hevy query keys are written. No key ever contains the Hevy API key. */
export const HEVY_KEYS = {
  /** Minor 168: per user, so an in-page user switch never shows the last owner's Hevy state. */
  status: (userId: string | null) => ["hevy", "status", userId] as const,
  /** Every user's status, for invalidation. */
  statusAll: ["hevy", "status"] as const,
  user: (userId: string | null) => ["hevy", "user", userId] as const,
  userAll: ["hevy", "user"] as const,
  /** Phase B: the stored mapping (`GET /v1/hevy/mapping`). */
  mapping: ["hevy", "mapping"] as const,
  /** Phase B: every Hevy exercise template, read with the key; in memory only. */
  templates: ["hevy", "templates"] as const,
};
