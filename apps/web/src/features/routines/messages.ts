// apps/web/src/features/routines/messages.ts
import { ROUTINE_ITEMS_MAX, ROUTINES_PER_USER_MAX } from "@sin/core";

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
