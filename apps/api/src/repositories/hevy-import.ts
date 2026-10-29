import type { HevyImportBatch, HevyImportOutcome, HevyImportResult, ImportedWorkout } from "@sin/core";

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

/** The write statements, in order; `match` fires at the start of the duplicate link's transaction, before its lock. */
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

/**
 * The batch log's running totals, filled as each workout is answered, so a batch that throws partway still logs what
 * it did (minor 158). Counts only.
 */
export interface HevyImportTally {
  results: number;
  setsCreated: number;
  setsDropped: number;
  outcomes: Partial<Record<HevyImportOutcome, number>>;
}

export function emptyHevyImportTally(): HevyImportTally {
  return { results: 0, setsCreated: 0, setsDropped: 0, outcomes: {} };
}

export interface HevyImportRepository {
  /**
   * §6.1: every workout of the batch in order; a dry run stops before any write and answers what the real run would.
   * `tally`, when given, is filled as each workout is answered.
   */
  importBatch(userId: string, batch: HevyImportBatch, now: Date, tally?: HevyImportTally): Promise<HevyImportBatchRecord>;
  /**
   * §6.2: one translated workout in one transaction, with its `imported` link and the stale-records flag. The routes
   * call only `importBatch` (which uses this); it is public as the integration tests' seam (minor 153): narrowing it
   * would mean driving every write case through a whole batch.
   */
  writeImportedWorkout(userId: string, hevyWorkoutId: string, w: ImportedWorkout): Promise<WriteOutcome>;
  /** §6.5: rebuilds the caller's records once if a batch left them stale; the only Hevy write that takes the PR lock. */
  finishImport(userId: string): Promise<{ recomputed: boolean; rootCount: number }>;
}
