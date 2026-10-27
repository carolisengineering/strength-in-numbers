/** The Exercises tab's paths (Spec 18.2 D1). No other module writes these strings. */
export const EXERCISES_PATH = "/app/exercises";
export const RECORDS_PATH = "/app/exercises/records";

/** One exercise's page; the id is one encoded path segment. */
export const exercisePath = (id: string): string => `${EXERCISES_PATH}/${encodeURIComponent(id)}`;

/** Router state on a Records row link, so the page's back link returns to Records (D18). */
export const FROM_RECORDS = { from: "records" } as const;

/** Whether router state says the page was opened from a Records row (it then offers "Back to Records"). */
export const isFromRecords = (state: unknown): boolean => (state as { from?: unknown } | null)?.from === "records";
