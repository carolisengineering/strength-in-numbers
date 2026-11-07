/**
 * Spec 21.0 §6.2, AC7 — the world the cross-user cases run in: users A (the
 * actor), B (the victim) and C (an actor with no live workout).
 */

/** The ids of one user's data set; A and B have the same shape. */
export interface Owned {
  userId: string;
  [name: string]: string;
}

export interface World {
  a: Owned;
  b: Owned & { markers: string[]; allIds: string[] };
  c: { userId: string; routineId: string };
}
