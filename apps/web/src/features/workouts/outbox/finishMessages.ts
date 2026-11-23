/**
 * Spec 06.7 §6.10: every string of the offline finish, re-exported from `messages.ts`. The only dynamic values are
 * integers (AC33): no set value, exercise name, id or time is ever interpolated.
 */

export const SAVED_OFFLINE =
  "Workout saved on this phone. There's no signal, so it isn't in the cloud yet. It sends when the app is open and you have signal. If you close the app, it might not reopen until you have signal, but your workout stays safe on this phone. Personal records will show after it sends.";
export const SAVED_SLOW =
  "Workout saved on this phone. Your signal is weak, so it isn't in the cloud yet. It keeps trying while the app is open. If you close the app, it sends the next time you open it with signal. Personal records will show after it sends.";
export const NOT_DURABLE =
  "Your workout hasn't sent yet, and this phone couldn't save it. Keep this page open until it sends. If you close the page, the workout will be lost.";
export const SENT = "Sent to the cloud.";
export const SAVED_ELSEWHERE =
  "Your workout is saved. It had already been finished on another device, so this phone's end time wasn't used.";
export const EDIT_AFTER_SEND = "You can edit this workout after it sends.";
export const START_BLOCKED_MESSAGE = "Your last workout hasn't sent yet. You can start a new one after it does.";
export const WAITING_OFFLINE = "No signal. It sends when the app is open and you have signal.";
export const WAITING_ONLINE = "Sending…";
export const KEEP_OPEN = "Keep this page open.";
export const FINISH_OFFLINE_NOTE =
  "No signal. Finish saves this workout on your phone, and it sends when you're back online with the app open.";
export const REFUSED_LEAD = "Your workout is still open — it couldn't be finished.";
export const REFUSED_OTHER = "The server refused it. Check your workout, then tap Finish again.";
export const GONE_TITLE = "This workout couldn't be saved";
export const GONE_BODY = "It was deleted on another device.";
export const GONE_DISCARD = "Discard from this phone";
export const GONE_CONFIRM = "Discard this workout from this phone? This can't be undone.";

export const waitingTitle = (n: number): string =>
  n === 1 ? "1 workout waiting to send" : `${n} workouts waiting to send`;

export const finishUnsentNote = (n: number): string =>
  n === 1 ? "1 set hasn't sent yet. It sends first." : `${n} sets haven't sent yet. They send first.`;

/** AC27, §12 D18: `lifts` is the summary heading's count (lifts with a row that rose); `null` or 0 says no number. */
export const landedLine = (lifts: number | null): string => {
  if (lifts === null || lifts <= 0) return "Your workout saved.";
  return lifts === 1 ? "Your workout saved: a new record" : `Your workout saved: new records on ${lifts} lifts`;
};

/** AC29: `rows` refused rows, the status line's count; "set(s)" when all `rows` are sets, else "thing(s)" (minor 697). */
export const refusedBlocked = (rows: number, sets: number): string => {
  if (rows === sets) {
    return rows === 1
      ? "1 set couldn't be saved. Fix or discard it, then tap Finish again."
      : `${rows} sets couldn't be saved. Fix or discard them, then tap Finish again.`;
  }
  return rows === 1
    ? "1 thing couldn't be saved. Fix or discard it, then tap Finish again."
    : `${rows} things couldn't be saved. Fix or discard them, then tap Finish again.`;
};

export const refusedIncomplete = (n: number): string =>
  n === 1
    ? "1 working set is missing data. Fix or delete it, then tap Finish again."
    : `${n} working sets are missing data. Fix or delete them, then tap Finish again.`;

/** AC21: the session's status line and the Workout menu's reason while any op of the workout has failed. */
export const finishLocked = (n: number): string =>
  n === 1 ? "1 thing couldn't be saved — fix it first" : `${n} things couldn't be saved — fix them first`;
