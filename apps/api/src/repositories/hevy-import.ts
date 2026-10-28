import type { ImportedWorkout } from "@sin/core";

/**
 * Spec 19.1 Phase B: the Hevy bulk import, for one user. Every statement is scoped to `userId`; a batch writes one
 * workout per transaction and never recomputes records (D3) — the `hevy_account.records_stale` flag and `finish` do.
 */

/** A stored link for a Hevy workout id; `workoutId` is `null` on a tombstone (the SIN workout was deleted). */
export interface HevyLinkHit {
  workoutId: string | null;
  origin: "sent" | "imported" | "matched";
}

/** What one workout's write did (§6.2). */
export type WriteOutcome =
  | { kind: "created"; workoutId: string }
  /** `ON CONFLICT` on `hevy_link_hevy_id_key` returned no row: another write linked this Hevy id first. */
  | { kind: "already_linked" }
  /** An invariant failed (the pure re-check, a retired exercise, an FK or CHECK); nothing was written. */
  | { kind: "rejected" };

/** The write statements, in order; `match` is the duplicate link's insert. */
export type HevyImportWriteStep = "workout" | "sections" | "exercises" | "sets" | "link" | "match";

/** Test seams: `onWriteStep` runs after each write statement, inside its transaction (AC24). */
export interface HevyImportSeams {
  onWriteStep?: (step: HevyImportWriteStep) => void | Promise<void>;
}

export interface HevyImportRepository {
  /** §6.2: one translated workout in one transaction, with its `imported` link and the stale-records flag. */
  writeImportedWorkout(userId: string, hevyWorkoutId: string, w: ImportedWorkout): Promise<WriteOutcome>;
}
