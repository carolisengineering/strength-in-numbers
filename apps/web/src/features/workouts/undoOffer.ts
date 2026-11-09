import type { Modality, SetEntry, WorkoutExerciseDetail } from "@sin/core";

import { isSetOp, type IdMap, type OutboxOp } from "./outbox/ops";
import { matches } from "./outbox/project";
import { setValuesKey } from "./setDraft";

/** Spec 17.5 §6.1: the latest log's offer. Held in memory only (D2), so a reload ends it. */
export interface UndoOffer {
  exerciseId: string;
  exerciseName: string;
  modality: Modality;
  /** The set as the log returned it: `id` is the client key while the create is queued. */
  set: SetEntry;
  /** The Log button's label as it was, without "Log " (AC1). */
  value: string;
  /** The rest this log started, or `null` when it cleared or started none (AC9). */
  restStartedAt: number | null;
}

/**
 * The offered set as it stands on screen, or `null` once it no longer exists (AC8). A queued create's row swaps its
 * client key for the server id when it syncs, so both are tried; a change to its values ends the offer too, because
 * Undo would then take back something other than what the line names.
 */
export function offeredRow(offer: UndoOffer, exercises: readonly WorkoutExerciseDetail[]): SetEntry | null {
  const { id, clientGeneratedId } = offer.set;
  const sets = exercises.find((exercise) => exercise.id === offer.exerciseId)?.sets ?? [];
  const row = sets.find((candidate) => candidate.id === id || (clientGeneratedId !== null && candidate.clientGeneratedId === clientGeneratedId));
  return row !== undefined && setValuesKey(row) === setValuesKey(offer.set) ? row : null;
}

export type UndoPhase = "undoing" | "undone" | "failed";

/** AC6: "undone" only when no op for that set remains in the queue. */
export function undoPhase(row: SetEntry, ops: readonly OutboxOp[], idMap: IdMap): UndoPhase {
  const own = ops.filter(isSetOp).filter((op) => matches(row, op.target, idMap));
  if (own.some((op) => op.status === "failed")) return "failed";
  return own.length > 0 ? "undoing" : "undone";
}

export function undoLine(phase: UndoPhase, setNumber: number): string | null {
  if (phase === "failed") return null; // the row's own "Couldn't save" and SyncStatus say it (AC6)
  return phase === "undoing" ? `Undoing set ${setNumber}…` : `Set ${setNumber} undone`;
}

export function undoAnnouncement(phase: UndoPhase, setNumber: number): string | null {
  if (phase === "failed") return null;
  return phase === "undoing" ? `Undoing set ${setNumber}` : `Set ${setNumber} undone`;
}

export const confirmationLine = (setNumber: number, value: string): string => `Set ${setNumber} logged · ${value}`;

export const undoName = (setNumber: number, value: string, exerciseName: string): string => `Undo set ${setNumber}, ${value}, ${exerciseName}`;

/** AC2: Undo's result and 17.4's messages share the line; the plain confirmation gives way to either. */
export function statusLineText(input: { undo: string | null; messages: readonly string[]; confirmation: string | null }): string {
  const parts = [...(input.undo === null ? [] : [input.undo]), ...input.messages];
  return parts.length > 0 ? parts.join(" · ") : (input.confirmation ?? "");
}
