import { normalizeExerciseName, type CreateExercise, type Exercise } from "@sin/core";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { EXERCISE_LIMIT_MESSAGE } from "../../catalog/fieldErrors";
import { classifyExerciseError } from "../../exercises/exerciseErrors";
import { LIMIT_MESSAGE, OFFLINE_SAVE, RATE_LIMITED } from "../messages";
import type { PreparedBody } from "../RoutineEditor";
import type { Draft } from "../routineDraft";
import type { RoutineWriteInput } from "../validateDraft";
import type { PendingExercise } from "./handoff";
import { createFailed } from "./messages";

/**
 * Spec 10.4 AC31–AC33, D17: Save's first half for an import. Creates each pending exercise an item still
 * references — one at a time, in first-appearance order, online-only (`createCustom` is a direct POST) —
 * then swaps the placeholder ids for the created ids in the request body only (the draft keeps its
 * placeholders). The session's `SaveRecord` makes a retry reuse what an earlier attempt created.
 */
export interface SaveRecord {
  /** Placeholder → the exercise created for it, and the name (normalized) it was created under. */
  readonly created: Map<string, { readonly id: string; readonly nameKey: string }>;
  attempts: number;
}

export interface SaveImportDeps {
  readonly createCustom: (input: CreateExercise) => Promise<Exercise>;
  readonly refresh: (force: boolean) => Promise<void>;
  /** Read after the refresh, from the store. */
  readonly visibleRows: () => readonly Exercise[];
}

/** The placeholders the draft's items still reference, in item order, each once. */
export function referencedPending(draft: Draft, pending: ReadonlyMap<string, PendingExercise>): string[] {
  const seen = new Set<string>();
  for (const item of draft.items) if (pending.has(item.exerciseId)) seen.add(item.exerciseId);
  return [...seen];
}

/** The body with every mapped exercise id replaced; the input is not changed. */
export function withExerciseIds(body: RoutineWriteInput, ids: ReadonlyMap<string, string>): RoutineWriteInput {
  return { ...body, items: body.items.map((item) => (ids.has(item.exerciseId) ? { ...item, exerciseId: ids.get(item.exerciseId)! } : item)) };
}

function failureOf(error: unknown, name: string): PreparedBody {
  if (error instanceof ApiError) {
    // The exercise writes' one classifier (deferred minor 35); the import keeps its own wording.
    const kind = classifyExerciseError(error);
    if (kind === "network") return { ok: false, message: OFFLINE_SAVE, requestId: null };
    if (kind === "limit") return { ok: false, message: EXERCISE_LIMIT_MESSAGE, requestId: null };
    if (kind === "rate-limited") return { ok: false, message: RATE_LIMITED, requestId: null };
    return { ok: false, message: createFailed(name), requestId: error.requestId };
  }
  reportError(error, { source: "routine-import", op: "create-exercise" });
  return { ok: false, message: createFailed(name), requestId: null };
}

export async function prepareImportBody(
  args: {
    body: RoutineWriteInput;
    draft: Draft;
    pending: ReadonlyMap<string, PendingExercise>;
    record: SaveRecord;
    /** The routine list is at ROUTINES_PER_USER_MAX: say so and create nothing (no leftovers). */
    atLimit: boolean;
    /** Aborted when the owner leaves the editor mid-Save: no further exercise is created. */
    signal?: AbortSignal;
  },
  deps: SaveImportDeps,
): Promise<PreparedBody> {
  const { body, draft, pending, record, atLimit, signal } = args;
  if (atLimit) return { ok: false, message: LIMIT_MESSAGE, requestId: null };
  const retry = record.attempts > 0;
  record.attempts += 1;
  // An earlier attempt's response may have been lost: look at the list again before creating anything.
  if (retry) await deps.refresh(true);
  // On a retry, what is in the list now: a recorded exercise deleted elsewhere is not reused, and a create
  // whose response was lost is found by its name.
  const visible = retry ? deps.visibleRows() : [];
  const visibleIds = new Set<string>(visible.map((row) => row.id));
  const byName = new Map<string, Exercise>();
  for (const row of visible) {
    const key = normalizeExerciseName(row.name);
    if (!byName.has(key)) byName.set(key, row);
  }

  const ids = new Map<string, string>();
  for (const placeholder of referencedPending(draft, pending)) {
    if (signal?.aborted) return { ok: false, message: "", requestId: null };
    const { input } = pending.get(placeholder)!;
    const nameKey = normalizeExerciseName(input.name);
    const earlier = record.created.get(placeholder);
    if (earlier && earlier.nameKey === nameKey && (!retry || visibleIds.has(earlier.id))) {
      ids.set(placeholder, earlier.id);
      continue;
    }
    const found = retry ? byName.get(nameKey) : undefined;
    if (found) {
      record.created.set(placeholder, { id: found.id, nameKey });
      ids.set(placeholder, found.id);
      continue;
    }
    try {
      const created = await deps.createCustom(input);
      record.created.set(placeholder, { id: created.id, nameKey });
      ids.set(placeholder, created.id);
    } catch (error) {
      return failureOf(error, input.name);
    }
  }
  return { ok: true, body: withExerciseIds(body, ids) };
}
