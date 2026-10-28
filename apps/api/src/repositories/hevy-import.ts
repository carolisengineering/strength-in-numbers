import type { HevyImportBatch, HevyImportResult, ImportedWorkout } from "@sin/core";

/** Spec 19.1 §8: the batch route's request-body limit. */
export const HEVY_IMPORT_BODY_LIMIT = 512 * 1024;

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

/** One batch's results, in request order, and the set totals for its log line (AC32). */
export interface HevyImportBatchRecord {
  results: HevyImportResult[];
  /** Sets in `create` results. */
  setsCreated: number;
  /** Sets dropped from `create` results (every set-level drop code; `exercise_no_sets` counts exercises). */
  setsDropped: number;
}

export interface HevyImportRepository {
  /** §6.1: every workout of the batch in order; a dry run stops before any write and answers what the real run would. */
  importBatch(userId: string, batch: HevyImportBatch, now: Date): Promise<HevyImportBatchRecord>;
  /** §6.2: one translated workout in one transaction, with its `imported` link and the stale-records flag. */
  writeImportedWorkout(userId: string, hevyWorkoutId: string, w: ImportedWorkout): Promise<WriteOutcome>;
  /** §6.5: rebuilds the caller's records once if a batch left them stale; the only Hevy write that takes the PR lock. */
  finishImport(userId: string): Promise<{ recomputed: boolean; rootCount: number }>;
}
