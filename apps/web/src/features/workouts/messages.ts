import type { Unsaved } from "./logoutGuard";

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

export function unsavedMessage({ sets, notes }: Unsaved): string {
  if (sets === 0 && notes === 0) return "Some changes haven't saved. If you sign out now they'll be lost.";
  const subject =
    notes === 0 ? plural(sets, "set", "sets") : sets === 0 ? plural(notes, "note", "notes") : `${plural(sets, "set", "sets")} and ${plural(notes, "note", "notes")}`;
  const single = sets + notes === 1;
  return single
    ? `${subject} hasn't saved. If you sign out now it'll be lost.`
    : `${subject} haven't saved. If you sign out now they'll be lost.`;
}

/** Spec 10.5 AC11 / AC20: the one-off line and checkbox in both Finish dialogs (straight single quotes). */
export const KEEP_IN_ROUTINES = "Keep it in my routines";
export const oneOffFinishLine = (name: string): string => `'${name}' is a one-off: it leaves your routines when you finish.`;
