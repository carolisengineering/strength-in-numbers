import type { Unsaved } from "./logoutGuard";

/** The only source of the sign-out guard's text (Spec 06.5 AC22). N is the only dynamic value, an integer. */
export const MESSAGES = {
  syncingTitle: "Saving your sets…",
  syncingBody: "Saving your sets…",
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
