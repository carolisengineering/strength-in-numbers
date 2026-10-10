// apps/web/src/features/routines/targetFormat.ts
import { ROUTINE_ITEM_NOTES_MAX, RoutineItemInputSchema } from "@sin/core";

/**
 * Routine target parsing and display (Spec 10.0 AC9). Pure — no React, no DOM. Every bound is checked
 * through the core write schema, so the item sheet can never accept a value the API would reject.
 * Spec 10.1 reuses `targetLine` for the exercise cards of a started workout.
 */

export interface Targets {
  readonly targetSets: number | null;
  readonly targetRepsLow: number | null;
  readonly targetRepsHigh: number | null;
  readonly targetRpe: number | null;
  readonly restSeconds: number | null;
}

export type Parsed<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly message: string };

export const SETS_MESSAGE = "Enter sets as a whole number from 1 to 20";
export const REPS_MESSAGE = "Enter reps like 8 or 8-10 (1 to 100, low first)";
export const REST_MESSAGE = "Enter rest as m:ss, like 1:30 (up to 15:00)";
export const NOTES_MESSAGE = `Keep notes to ${ROUTINE_ITEM_NOTES_MAX} characters`;

const shape = RoutineItemInputSchema.shape;

const accepts = (schema: { safeParse: (value: unknown) => { success: boolean } }, value: number): boolean =>
  schema.safeParse(value).success;

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value });
const bad = (message: string): Parsed<never> => ({ ok: false, message });

export function parseSets(text: string): Parsed<number | null> {
  const t = text.trim();
  if (t === "") return ok(null);
  if (!/^\d+$/.test(t)) return bad(SETS_MESSAGE);
  const n = Number(t);
  return accepts(shape.targetSets, n) ? ok(n) : bad(SETS_MESSAGE);
}

const REPS = /^(\d+)(?:\s*[-–]\s*(\d+))?$/;

export function parseReps(text: string): Parsed<{ low: number | null; high: number | null }> {
  const t = text.trim();
  if (t === "") return ok({ low: null, high: null });
  const match = REPS.exec(t);
  if (!match) return bad(REPS_MESSAGE);
  const low = Number(match[1]);
  const high = match[2] === undefined ? low : Number(match[2]);
  if (!accepts(shape.targetRepsLow, low) || !accepts(shape.targetRepsHigh, high) || low > high) return bad(REPS_MESSAGE);
  return ok({ low, high });
}

const REST = /^(\d{1,2}):([0-5]\d)$/;

/** `"1:30"` → 90. Blank is "no target" (`null`); `"0:00"` is a real zero-second rest. */
export function parseRest(text: string): Parsed<number | null> {
  const t = text.trim();
  if (t === "") return ok(null);
  const match = REST.exec(t);
  if (!match) return bad(REST_MESSAGE);
  const seconds = Number(match[1]) * 60 + Number(match[2]);
  return accepts(shape.restSeconds, seconds) ? ok(seconds) : bad(REST_MESSAGE);
}

export function parseNotes(text: string): Parsed<string | null> {
  const t = text.trim();
  if (t === "") return ok(null);
  return t.length > ROUTINE_ITEM_NOTES_MAX ? bad(NOTES_MESSAGE) : ok(t);
}

export function formatRest(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The sheet's input form: `"8"` or `"8-10"`; `""` when unset. */
export function formatReps(low: number | null, high: number | null): string {
  if (low === null || high === null) return "";
  return low === high ? `${low}` : `${low}-${high}`;
}

/** 6, 6.5 … 10 — whatever halves the core schema accepts (Spec 09 AC10). */
export const RPE_CHOICES: readonly number[] = Array.from({ length: 21 }, (_, i) => i / 2).filter((v) =>
  accepts(shape.targetRpe, v),
);

function repsText(t: Targets): string | null {
  if (t.targetRepsLow === null || t.targetRepsHigh === null) return null;
  return t.targetRepsLow === t.targetRepsHigh ? `${t.targetRepsLow}` : `${t.targetRepsLow}–${t.targetRepsHigh}`;
}

/** "3 × 8–10 · RPE 8 · 2:00" — only what is set; `""` when nothing is. */
export function targetLine(t: Targets): string {
  const parts: string[] = [];
  const reps = repsText(t);
  if (t.targetSets !== null && reps !== null) parts.push(`${t.targetSets} × ${reps}`);
  else if (t.targetSets !== null) parts.push(t.targetSets === 1 ? "1 set" : `${t.targetSets} sets`);
  else if (reps !== null) parts.push(reps === "1" ? "1 rep" : `${reps} reps`);
  if (t.targetRpe !== null) parts.push(`RPE ${t.targetRpe}`);
  if (t.restSeconds !== null) parts.push(formatRest(t.restSeconds));
  return parts.join(" · ");
}

/** "6 exercises · 2 supersets" (distinct non-null groups; the superset part omitted when none). */
export function routineSummary(routine: { readonly items: readonly { readonly supersetGroup: number | null }[] }): string {
  const count = routine.items.length;
  const groups = new Set(routine.items.map((i) => i.supersetGroup).filter((g) => g !== null)).size;
  const exercises = count === 1 ? "1 exercise" : `${count} exercises`;
  if (groups === 0) return exercises;
  return `${exercises} · ${groups === 1 ? "1 superset" : `${groups} supersets`}`;
}

/** "Bench press, superset 1, 3 × 8–10" — the row's accessible name (AC18, AC27). */
export function itemAccessibleName(name: string, group: number | null, line: string, unavailable: boolean): string {
  return [name, group === null ? null : `superset ${group}`, line === "" ? null : line, unavailable ? "no longer available" : null]
    .filter((part): part is string => part !== null)
    .join(", ");
}
