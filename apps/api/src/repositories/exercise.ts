/**
 * Exercise-catalog repository contract (Spec 03.1 §3, §6.1).
 *
 * Every read here applies the **caller-visibility filter**
 * `owner_user_id IS NULL OR owner_user_id = :actingUserId` — `AND`ed onto every
 * query path, never an `OR` sibling of another clause (§6.1 security invariant).
 * No custom rows exist until Spec 03.2, but the filter is written now so 03.2 is
 * purely additive and the leak test (§10 AC5) has something to guard.
 *
 * Rows come back in DB shape (snake→camel, timestamps as `Date`); the route
 * layer maps them to the `@sin/core` wire DTOs. Ordering is locale-independent
 * (`COLLATE "C"`) so a DB's `LC_COLLATE` cannot change row order — and therefore
 * the `ETag` — between Testcontainers Postgres and Neon (§6.1).
 */

/** One `exercise` row, all columns. */
export interface ExerciseRecord {
  id: string;
  catalogKey: string | null;
  ownerUserId: string | null;
  name: string;
  modality: string;
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
  equipmentId: string | null;
  isActive: boolean;
  /** Spec 03.2 — null unless this row is a copy-on-write fork of a global row. */
  forkedFromExerciseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A `muscle_group` / `equipment` row projected to the wire fields (§6.2). */
export interface ReferenceRecord {
  id: string;
  name: string;
  displayOrder: number;
}

/**
 * A catalog read plus its opaque `syncToken` (Spec 03.3 §6.2): `"1.<xid>"`, where
 * the xid is `pg_snapshot_xmin(pg_current_snapshot())` taken **in the same
 * statement** that scanned `rows`. The client stores it and sends it back as the
 * next `?since=`.
 */
export interface CatalogPage {
  rows: ExerciseRecord[];
  syncToken: string;
}

/** The fields a caller can set on a custom exercise (Spec 03.2 §5). */
export interface ExerciseWriteFields {
  name: string;
  modality: string;
  primaryMuscleId: string | null;
  secondaryMuscleIds: string[];
  equipmentId: string | null;
}

/** A partial edit — `PATCH` body or `/fork` overlay body (Spec 03.2 §5, §6). */
export type ExerciseWritePatch = Partial<ExerciseWriteFields>;

export interface ExerciseRepository {
  /**
   * The caller-visible catalog. No `since` → the full pull: visible rows with
   * `is_active = true`, ordered by `name COLLATE "C"` then `id`. With `since` (a
   * bare xid decimal, already validated and stripped of its `1.` prefix by the
   * route) → the delta: visible rows with `change_xid >= since`, **no `is_active`
   * filter**, so a row retired since the client's last sync arrives as a
   * tombstone (`isActive: false`) for the client to drop.
   *
   * One SQL statement per call (§6.3): the token is computed in the same
   * statement as the row scan, including when the result is empty. Throws
   * `SyncTokenExpiredError` when `since` is ahead of the snapshot's `xmax`.
   */
  findCatalog(actingUserId: string, since?: string): Promise<CatalogPage>;

  /**
   * A single visible row by id, or throws Spec 01's `NotFoundError` (404, not
   * 403 — a probe must not tell "not yours" from "absent"). Consumed by Spec 05
   * to validate an `exercise_id` on a workout write; there is no HTTP
   * `GET /v1/exercises/{id}` in Spec 03.1 (§12 D5). Visibility filter only — no
   * `is_active` gate.
   */
  findVisibleById(actingUserId: string, id: string): Promise<ExerciseRecord>;

  /**
   * Creates an owned custom exercise: validates every reference id
   * (`primaryMuscleId`/`secondaryMuscleIds`/`equipmentId`) exists, then inserts
   * atomically under the shared 500-active-row cap (Spec 03.2 §6). Throws
   * `ValidationError` (bad reference ids) or `CustomExerciseLimitError` (cap hit).
   */
  createExercise(
    actingUserId: string,
    fields: ExerciseWriteFields,
  ): Promise<ExerciseRecord>;

  /**
   * Updates the caller's own custom row in place (Spec 03.2 §6). The
   * ownership/global/retired checks run ahead of the write; the actual `UPDATE`
   * additionally gates its own `WHERE` clause on `owner_user_id` + `is_active`
   * so a same-user race against a concurrent `DELETE` can never silently apply
   * an edit to a row that just became retired. Throws `NotFoundError` (not
   * visible), `ExerciseImmutableUseForkError` (target is global),
   * `ExerciseRetiredError` (target already soft-deleted), or `ValidationError`
   * (merged result fails the cross-field check).
   */
  updateExercise(
    actingUserId: string,
    id: string,
    patch: ExerciseWritePatch,
  ): Promise<ExerciseRecord>;

  /**
   * Copy-on-write forks a global, active row (Spec 03.2 §6): copies its
   * writable fields, applies `overlay` on top, re-runs the cross-field check on
   * the merged result, then inserts under the same shared cap as
   * `createExercise` with `forkedFromExerciseId` = the origin's id. Throws
   * `NotFoundError` (not visible), `ExerciseAlreadyOwnedError` (target is
   * already the caller's own row), `ExerciseRetiredError` (target
   * `isActive=false`), `ValidationError` (merged overlay conflicts), or
   * `CustomExerciseLimitError` (shared cap hit).
   */
  forkExercise(
    actingUserId: string,
    originId: string,
    overlay: ExerciseWritePatch,
  ): Promise<ExerciseRecord>;

  /**
   * Soft-deletes the caller's own custom row (`is_active = false`), idempotent
   * — a repeat call is a no-op success (Spec 03.2 §6, AC9). Throws
   * `NotFoundError` (not visible) or `ExerciseImmutableError` (target is a
   * global row — a visible row, so 403 not 404, D19).
   */
  deleteExercise(actingUserId: string, id: string): Promise<void>;

  /** All muscle groups, ordered by `display_order` then `id COLLATE "C"`. */
  listMuscleGroups(): Promise<ReferenceRecord[]>;

  /** All equipment, ordered by `display_order` then `id COLLATE "C"`. */
  listEquipment(): Promise<ReferenceRecord[]>;
}
