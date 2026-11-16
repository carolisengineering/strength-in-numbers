import type { Unsaved } from "./logoutGuard";

// Spec 06.7 AC33: the offline-finish copy lives in its own file and is re-exported here, the workouts copy file.
export * from "./outbox/finishMessages";

/** The only source of the sign-out guard's text (Spec 06.5 AC22). N is the only dynamic value, an integer. */
export const MESSAGES = {
  syncingTitle: "Saving your sets…",
  syncingBody: "Trying to send them now…",
  cancel: "Cancel",
  warningTitle: "Sign out with unsaved sets?",
  stay: "Stay",
  signOutAnyway: "Sign out anyway",
} as const;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function unsavedMessage({ sets, notes, timerEntries = 0, workouts = 0 }: Unsaved): string {
  if (sets === 0 && notes === 0 && timerEntries === 0 && workouts === 0) return "Some changes haven't saved. If you sign out now they'll be lost.";
  // Spec 06.7 AC11: a waiting workout alone "hasn't sent" (it is saved on this phone, not in the cloud).
  if (sets === 0 && notes === 0 && timerEntries === 0) {
    return workouts === 1
      ? "1 finished workout hasn't sent. If you sign out now it'll be lost."
      : `${workouts} finished workouts haven't sent. If you sign out now they'll be lost.`;
  }
  // "A", "A and B", or "A, B and C", in the order finished workouts, sets, notes, timer entries (Spec 10.7 AC39).
  const parts = [
    ...(workouts > 0 ? [plural(workouts, "finished workout", "finished workouts")] : []),
    ...(sets > 0 ? [plural(sets, "set", "sets")] : []),
    ...(notes > 0 ? [plural(notes, "note", "notes")] : []),
    ...(timerEntries > 0 ? [plural(timerEntries, "timer entry", "timer entries")] : []),
  ];
  const subject = parts.length === 1 ? parts[0]! : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)!}`;
  const single = sets + notes + timerEntries + workouts === 1;
  return single
    ? `${subject} hasn't saved. If you sign out now it'll be lost.`
    : `${subject} haven't saved. If you sign out now they'll be lost.`;
}

/** Spec 10.5 AC11 / AC20: the one-off line and checkbox in both Finish dialogs (straight single quotes). */
export const KEEP_IN_ROUTINES = "Keep it in my routines";
export const oneOffFinishLine = (name: string): string => `'${name}' is a one-off: it leaves your routines when you finish.`;
