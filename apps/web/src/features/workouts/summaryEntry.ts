/**
 * Minor 696: a summary opened from its own section's list (History's row; Workouts' Finish and its waiting card)
 * carries this in the location state, so a delete there can go Back to that list instead of pushing a second copy of
 * it. The app can't read the entry before it, so the link that made the entry says so.
 */
export const FROM_HOME = { fromHome: true } as const;

export function isFromHome(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { fromHome?: unknown }).fromHome === true;
}

/** The state for a link from `pathname` to a summary: marked only when the link sits on the section's list itself. */
export function summaryEntryState(pathname: string, home: string): typeof FROM_HOME | undefined {
  return pathname === home ? FROM_HOME : undefined;
}
