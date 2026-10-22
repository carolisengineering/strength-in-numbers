import { ROUTINE_ITEMS_MAX, ROUTINE_ONE_OFF_DAYS, ROUTINE_SECTIONS_MAX, ROUTINES_PER_USER_MAX, SECTION_NAME_MAX, SECTION_NOTES_MAX } from "@sin/core";

/** Spec 10.0 copy shared by more than one routine screen. */
export const LIMIT_MESSAGE = `You've reached ${ROUTINES_PER_USER_MAX} routines — delete one to add another`;
export const ITEMS_CAP_MESSAGE = `A routine can have up to ${ROUTINE_ITEMS_MAX} exercises`;
export const ROUTINE_GONE = "That routine no longer exists";
export const OFFLINE_SAVE = "You're offline — your changes are still here, try again when connected";
export const OFFLINE_DELETE = "You're offline — try again when connected";
export const RATE_LIMITED = "Too many changes in a short time — wait a minute and try again";
export const SAVE_FAILED = "Couldn't save this routine — try again.";
export const DELETE_FAILED = "Couldn't delete this routine — try again.";
export const LOAD_LIST_FAILED = "Couldn't load routines";
export const REFRESH_LIST_FAILED = "Couldn't refresh your routines";
export const LOAD_ONE_FAILED = "Couldn't load this routine";
export const EMPTY_ROUTINES = "Routines are reusable workouts — build one, then start it in a tap.";
export const ADJUSTED_NOTICE = "Supersets were adjusted so grouped exercises sit together";
export const START_RETIRED = "One of this routine's exercises is no longer available. Edit the routine to replace it.";
export const ACTIVE_BLOCKS_START = "Finish your current workout first";

/** Spec 10.3 section copy. */
export const SECTION_STARTERS = ["Warm-up", "Main", "Accessory", "Finisher", "Cooldown"] as const;
export const SECTIONS_CAP_MESSAGE = `A routine can have up to ${ROUTINE_SECTIONS_MAX} sections`;
export const SECTION_EMPTY_HINT = "No exercises yet — use Move to section on an exercise";
export const SECTION_UNLINK_NOTICE = "Supersets stay inside one section, so this exercise was unlinked";
export const SECTION_NAME_REQUIRED = "Give the section a name";
export const SECTION_NAME_TOO_LONG = `Keep section names to ${SECTION_NAME_MAX} characters`;
export const SECTION_NAME_INVALID = "Check the section name — remove unusual characters";
export const SECTION_NOTES_TOO_LONG = `Keep section notes to ${SECTION_NOTES_MAX} characters`;
export const SECTION_NOTES_INVALID = `Keep section notes to ${SECTION_NOTES_MAX} characters, without unusual characters`;

/** Spec 10.5 one-off copy (AC20; the O1 defaults for the status, the failure and the past-expiry forms). */
export const ONE_OFF_TAG = "One-off";
export const KEEP_AS_ROUTINE = "Keep as a routine";
export const KEPT_STATUS = "Kept in your routines.";
export const KEEP_FAILED = "Couldn't keep this routine — try again.";
export const OFFLINE_KEEP = OFFLINE_DELETE;
/** "6 exercises · 2 supersets · from text · until Fri 30 Oct"; no "until" when `day` is null (past expiry). */
export const oneOffMetaText = (summary: string, day: string | null): string =>
  `${summary} · from text${day === null ? "" : ` · until ${day}`}`;
export const oneOffNoteText = (day: string | null): string =>
  day === null
    ? "Leaves your routines when you finish a workout from it. Your workout stays in History."
    : `Leaves your routines when you finish a workout from it, or after ${ROUTINE_ONE_OFF_DAYS} days, on ${day}. Your workout stays in History.`;
