import { normalizeExerciseName, type CreateExercise, type Exercise, type HevyMapping } from "@sin/core";

import { ApiError } from "../../../api";
import { reportError } from "../../../observability/reportError";
import { EXERCISE_LIMIT_MESSAGE } from "../../catalog/fieldErrors";
import { classifyExerciseError } from "../../exercises/exerciseErrors";
import type { PairInput } from "../mapping/useMappingMutations";
import { classifyMappingError } from "../mapping/useMappingMutations";
import { HEVY_COPY, MAPPING_OFFLINE, MAPPING_RATE_LIMITED, MAPPING_SAVE_FAILED, createFailed } from "../messages";
import type { PairingDecision } from "./pairingCards";

/**
 * Spec 20.0 AC28, AC29, §6.6, React-free: the pairing cards' decisions written to SIN. New exercises are created one
 * at a time, at least `CREATE_GAP_MS` apart (under the exercise write group's 15 a minute, D7), then every pair goes
 * in `PATCH` batches of `PAIR_BATCH_MAX`. Nothing is written until the parent calls this (AC29); a create that fails
 * stops before any pair is written. A retry refreshes the catalog first and reuses what an earlier attempt made, so a
 * lost response never makes the same exercise twice (Review Focus 3, the routine import's rule).
 */

export const CREATE_GAP_MS = 4_000;
export const PAIR_BATCH_MAX = 200;

/** What earlier attempts created, keyed by Hevy template id. Lives as long as the screen that saves. */
export interface PairingSaveRecord {
  created: Map<string, { id: string; nameKey: string }>;
  attempts: number;
}

export const newPairingSaveRecord = (): PairingSaveRecord => ({ created: new Map(), attempts: 0 });

export interface SavePairingsDeps {
  createCustom(input: CreateExercise): Promise<Exercise>;
  refresh(force: boolean): Promise<void>;
  visibleRows(): readonly Exercise[];
  patchMapping(body: { upsert: PairInput[] }): Promise<HevyMapping>;
  sleep(ms: number, signal?: AbortSignal): Promise<void>;
  now(): number;
}

export type SavePairingsResult = { ok: true; mapping: HevyMapping } | { ok: false; message: string; stage: "create" | "pairs" };

function createFailure(error: unknown, name: string): SavePairingsResult {
  const kind = classifyExerciseError(error);
  if (kind === "network") return { ok: false, message: MAPPING_OFFLINE, stage: "create" };
  if (kind === "limit") return { ok: false, message: EXERCISE_LIMIT_MESSAGE, stage: "create" };
  if (kind === "rate-limited") return { ok: false, message: MAPPING_RATE_LIMITED, stage: "create" };
  if (!(error instanceof ApiError)) reportError(error, { source: "hevy", op: "create-exercise" });
  return { ok: false, message: createFailed(name), stage: "create" };
}

const stopped: SavePairingsResult = { ok: false, message: HEVY_COPY.aborted, stage: "create" };

export async function savePairings(
  args: {
    decisions: readonly PairingDecision[];
    record: PairingSaveRecord;
    signal?: AbortSignal;
    onProgress?: (p: { created: number; total: number }) => void;
  },
  deps: SavePairingsDeps,
): Promise<SavePairingsResult> {
  const { decisions, record, signal, onProgress } = args;
  const retry = record.attempts > 0;
  record.attempts += 1;
  // An earlier attempt's response may have been lost: look at the list again before creating anything.
  if (retry) await deps.refresh(true);
  const visible = retry ? deps.visibleRows() : [];
  const visibleIds = new Set<string>(visible.map((row) => row.id));
  const byName = new Map<string, Exercise>();
  for (const row of visible) {
    const key = normalizeExerciseName(row.name);
    if (key !== "" && !byName.has(key)) byName.set(key, row);
  }

  const creates = decisions.filter((d): d is Extract<PairingDecision, { action: "create" }> => d.action === "create");
  const ids = new Map<string, string>();
  let lastCreateAt: number | null = null;
  let done = 0;
  for (const d of creates) {
    if (signal?.aborted) return stopped;
    const nameKey = normalizeExerciseName(d.create.name);
    const earlier = record.created.get(d.template.id);
    const found = retry ? byName.get(nameKey) : undefined;
    if (earlier && earlier.nameKey === nameKey && (!retry || visibleIds.has(earlier.id))) {
      ids.set(d.template.id, earlier.id);
    } else if (found) {
      record.created.set(d.template.id, { id: found.id, nameKey });
      ids.set(d.template.id, found.id);
    } else {
      // D7: creates at least CREATE_GAP_MS apart.
      if (lastCreateAt !== null) {
        const gap = CREATE_GAP_MS - (deps.now() - lastCreateAt);
        if (gap > 0) await deps.sleep(gap, signal);
        if (signal?.aborted) return stopped;
      }
      let created: Exercise;
      try {
        try {
          created = await deps.createCustom(d.create);
        } catch (error) {
          // One retry after a 429, once its Retry-After has passed.
          if (!(error instanceof ApiError) || error.status !== 429) throw error;
          await deps.sleep(Math.max(error.retryAfterMs ?? CREATE_GAP_MS, CREATE_GAP_MS), signal);
          if (signal?.aborted) return stopped;
          created = await deps.createCustom(d.create);
        }
      } catch (error) {
        return createFailure(error, d.create.name);
      }
      lastCreateAt = deps.now();
      record.created.set(d.template.id, { id: created.id, nameKey });
      ids.set(d.template.id, created.id);
    }
    done += 1;
    onProgress?.({ created: done, total: creates.length });
  }
  if (signal?.aborted) return stopped;

  // Every pair is written with exportAs false: the server promotes an exercise's first pairing (19.0 AC24).
  const pairs: PairInput[] = decisions.map((d) => {
    const base = { hevyTemplateId: d.template.id, hevyTitle: d.template.title, hevyType: d.template.type, exportAs: false };
    if (d.action === "skip") return { ...base, role: "skip", exerciseId: null, measureRule: null };
    const exerciseId = d.action === "pair" ? d.exerciseId : ids.get(d.template.id)!;
    return { ...base, role: "exercise", exerciseId, measureRule: d.rule };
  });
  let mapping: HevyMapping | null = null;
  for (let i = 0; i < pairs.length; i += PAIR_BATCH_MAX) {
    try {
      mapping = await deps.patchMapping({ upsert: pairs.slice(i, i + PAIR_BATCH_MAX) });
    } catch (error) {
      const kind = classifyMappingError(error);
      if (kind === "other") reportError(error, { source: "hevy", op: "mapping-patch" });
      const message = kind === "offline" ? MAPPING_OFFLINE : kind === "rate_limited" ? MAPPING_RATE_LIMITED : MAPPING_SAVE_FAILED;
      return { ok: false, message, stage: "pairs" };
    }
  }
  return { ok: true, mapping: mapping ?? { pairs: [], sectionRules: [] } };
}
