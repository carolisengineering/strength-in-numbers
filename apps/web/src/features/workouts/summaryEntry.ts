/**
 * Minor 696: a summary opened from its own section's list (History's row; Workouts' Finish and its waiting card)
 * carries this in the location state, so a delete there can go Back to that list instead of pushing a second copy of
 * it. The app can't read the entry before it, so the link that made the entry says so.
 */
export const FROM_HOME = { fromHome: true } as const;

export function isFromHome(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { fromHome?: unknown }).fromHome === true;
}

/**
 * Minor 715: the summary's Edit marks the edit entry, so Done can go Back to that summary (keeping its own
 * `fromHome`) instead of replacing the edit entry with a second, unmarked copy of it. Minor 763: when the summary
 * itself came from its list, the edit entry carries `fromHome` too, so Delete workout can go Back past the summary to
 * that list. Minor 764: only a summary whose own route names its workout marks Edit; History's index at desktop widths
 * (`/app/history`, no id) doesn't, so Done there replaces with the workout's own path.
 */
export const FROM_SUMMARY = { fromSummary: true } as const;

export function isFromSummary(state: unknown): boolean {
  return typeof state === "object" && state !== null && (state as { fromSummary?: unknown }).fromSummary === true;
}

/** The state for the summary's Edit: see `FROM_SUMMARY`. `summaryState` is the summary entry's own location state. */
export function editEntryState(routeNamesWorkout: boolean, summaryState: unknown): { fromSummary: true; fromHome?: true } | undefined {
  if (!routeNamesWorkout) return undefined;
  return isFromHome(summaryState) ? { fromSummary: true, fromHome: true } : FROM_SUMMARY;
}

/**
 * Minor 770: the workouts this tab deleted, so a `fromHome` summary whose workout is gone redirects to its list only
 * when it is the entry this tab's own delete left behind (minor 716). A workout deleted on another device still shows
 * Not found. The set lasts for the page load: after a reload, Forward to a workout deleted here shows Not found.
 */
const deletedOnThisLoad = new Set<string>();

export function markDeletedHere(workoutId: string): void {
  deletedOnThisLoad.add(workoutId);
}

export function deletedHere(workoutId: string): boolean {
  return deletedOnThisLoad.has(workoutId);
}

export function resetDeletedHereForTests(): void {
  deletedOnThisLoad.clear();
}

/** The state for a link from `pathname` to a summary: marked only when the link sits on the section's list itself. */
export function summaryEntryState(pathname: string, home: string): typeof FROM_HOME | undefined {
  return pathname === home ? FROM_HOME : undefined;
}
