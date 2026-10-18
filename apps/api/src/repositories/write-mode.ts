import type { PrismaClient } from "@prisma/client";
import { lockUserRecords, recomputeRecordsForRoots } from "./personal-record.prisma.js";
import type { RawClient } from "./set-entry.prisma.js";

/**
 * Spec 07.4 §6.1 — the transaction envelope every set / workout-exercise / workout write runs in.
 * `finished ⇔ ended_at IS NOT NULL`, and a workout never becomes live again, so the mode read by
 * the method's existing unlocked preflight is safe to act on: a finished-mode write takes the
 * per-user PR lock FIRST (07.0 AC18 lock order) because it will recompute records; a live-mode
 * write runs exactly today's statements. The one race — a finish committing between the preflight
 * and the write's row lock — is caught under that lock (`assertStillLive`) and restarts the
 * request once in finished mode.
 */
export type WriteMode = "live" | "finished";

/** Internal restart signal; never reaches a client. */
export class WriteModeChanged extends Error {
  constructor() {
    super("workout was finished between the preflight read and the row lock");
    this.name = "WriteModeChanged";
  }
}

/** Call right after the in-transaction read of `ended_at` under the row lock. */
export function assertStillLive(mode: WriteMode, endedAtUnderLock: Date | null): void {
  if (mode === "live" && endedAtUnderLock !== null) throw new WriteModeChanged();
}

export async function withWriteMode<T>(
  prisma: PrismaClient,
  userId: string,
  preflightEndedAt: Date | null,
  run: (tx: RawClient, mode: WriteMode) => Promise<T>,
): Promise<T> {
  const attempt = (mode: WriteMode) =>
    prisma.$transaction(async (tx) => {
      if (mode === "finished") await lockUserRecords(tx, userId);
      return run(tx, mode);
    });
  if (preflightEndedAt !== null) return attempt("finished");
  try {
    return await attempt("live");
  } catch (error) {
    if (!(error instanceof WriteModeChanged)) throw error;
    return attempt("finished"); // monotonic: a second flip cannot happen, so a WriteModeChanged here is a bug
  }
}

/** What a finished-mode write did, for the route's `workout_edited` line (§9). */
export interface FinishedEdit {
  workoutId: string;
  recordsRecomputed: boolean;
  rootCount: number;
  recomputeMs: number;
}

/** `recomputeRecordsForRoots` (unchanged, 07.0) with the timing §9 logs; no roots, no query. */
export async function recomputeTimed(
  tx: RawClient,
  userId: string,
  workoutId: string,
  roots: readonly string[],
): Promise<FinishedEdit> {
  if (roots.length === 0) return { workoutId, recordsRecomputed: false, rootCount: 0, recomputeMs: 0 };
  const started = performance.now();
  await recomputeRecordsForRoots(tx, userId, roots);
  return { workoutId, recordsRecomputed: true, rootCount: roots.length, recomputeMs: Math.round(performance.now() - started) };
}
