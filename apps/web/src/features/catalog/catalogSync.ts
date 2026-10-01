import type { Exercise } from "@sin/core";

import { ApiError } from "../../api/problem";

/**
 * Pure catalog-sync rules (Spec 06.0 §6.3). No React, no DOM — a Spec 16
 * candidate for promotion into `@sin/core`.
 */

/**
 * Merge a `since` delta into the stored rows by `id` (AC2). A row the delta
 * marks `isActive: false` is dropped, not kept as a tombstone. A full pull's
 * "replace" is this same function started from `[]`.
 */
export function mergeCatalogRows(
  stored: readonly Exercise[],
  incoming: readonly Exercise[],
): Exercise[] {
  const byId = new Map<string, Exercise>(stored.map((row) => [row.id, row]));
  for (const row of incoming) {
    if (row.isActive) byId.set(row.id, row);
    else byId.delete(row.id);
  }
  return [...byId.values()];
}

export type SyncFailure =
  | { kind: "reset"; reason: "410" | "422" }
  | { kind: "transient" };

/**
 * What a failed `GET /v1/exercises` means (AC3). `410 sync-token-expired` and
 * `422` (a malformed stored token) both mean "the token is unusable — pull
 * everything again"; anything else leaves the cached catalog in place.
 */
export function classifySyncFailure(error: unknown): SyncFailure {
  if (error instanceof ApiError && !error.isNetworkError) {
    if (error.status === 410) return { kind: "reset", reason: "410" };
    if (error.status === 422) return { kind: "reset", reason: "422" };
  }
  return { kind: "transient" };
}
