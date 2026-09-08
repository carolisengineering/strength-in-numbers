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
 * A catalog read plus its `serverTime` cursor (§6.1). `serverTime` is derived
 * from the catalog data — `MAX(updated_at)` over the caller's rows, clamped by
 * `transaction_timestamp()` and truncated **down** to whole milliseconds — never
 * the wall clock alone, so it can never be emitted ahead of the data. The client
 * persists it and sends it back as the next `updated_since`.
 */
export interface CatalogPage {
  rows: ExerciseRecord[];
  serverTime: Date;
}

export interface ExerciseRepository {
  /**
   * The full caller-visible catalog: visible rows with `is_active = true`,
   * ordered by `name COLLATE "C"` then `id`. Tombstones (`is_active = false`)
   * are excluded here — they surface only in an `updated_since` delta.
   * `serverTime` = `LEAST(transaction_timestamp(), MAX(updated_at))` over the
   * returned rows (or `transaction_timestamp()` when the visible set is empty),
   * truncated down to whole ms.
   */
  findVisibleCatalog(actingUserId: string): Promise<CatalogPage>;

  /**
   * The incremental delta: visible rows with `updated_at > sinceIso` — **no
   * `is_active` filter**, so a row retired since the client's last sync arrives
   * as a tombstone (`isActive: false`) for the client to drop. `sinceIso` is the
   * raw RFC 3339 string; it is cast in-query as `::timestamptz` (never through a
   * millisecond-precision `Date`) so a µs boundary is not moved.
   *
   * `serverTime` = `LEAST(transaction_timestamp(), GREATEST(sinceIso,
   * MAX(updated_at) over the returned rows))`, truncated down to whole ms:
   * non-empty → the newest returned row's timestamp; empty → `sinceIso` echoed
   * back, but clamped to server-now so a client-sent future cursor heals instead
   * of sticking.
   */
  findCatalogDelta(
    actingUserId: string,
    sinceIso: string,
  ): Promise<CatalogPage>;

  /**
   * A single visible row by id, or throws Spec 01's `NotFoundError` (404, not
   * 403 — a probe must not tell "not yours" from "absent"). Consumed by Spec 05
   * to validate an `exercise_id` on a workout write; there is no HTTP
   * `GET /v1/exercises/{id}` in Spec 03.1 (§12 D5). Visibility filter only — no
   * `is_active` gate.
   */
  findVisibleById(actingUserId: string, id: string): Promise<ExerciseRecord>;

  /** All muscle groups, ordered by `display_order` then `id COLLATE "C"`. */
  listMuscleGroups(): Promise<ReferenceRecord[]>;

  /** All equipment, ordered by `display_order` then `id COLLATE "C"`. */
  listEquipment(): Promise<ReferenceRecord[]>;
}
