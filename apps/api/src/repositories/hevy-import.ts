/**
 * Spec 19.1 Phase B: the Hevy bulk import, for one user. Every statement is scoped to `userId`; a batch writes one
 * workout per transaction and never recomputes records (D3) — the `hevy_account.records_stale` flag and `finish` do.
 */

/** A stored link for a Hevy workout id; `workoutId` is `null` on a tombstone (the SIN workout was deleted). */
export interface HevyLinkHit {
  workoutId: string | null;
  origin: "sent" | "imported" | "matched";
}
