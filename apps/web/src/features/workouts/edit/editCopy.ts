/**
 * Every pinned string of the edit screen (Spec 18.0 §5.4, §5.7 and the ACs), verbatim. Copy never
 * echoes a response body or a server message.
 */
export const EDIT_COPY = Object.freeze({
  offline: "You're offline — try again when you have signal",
  setMissing: "That set no longer exists",
  exerciseMissing: "That exercise was removed from the workout",
  vanished: "That workout no longer exists.",
  refreshFailed: "Couldn't refresh your workout — showing the last copy we have.",
  loadFailed: "Couldn't load this workout.",
  deleteFailed: "Couldn't delete the workout — try again",
  saving: "Saving…",
  unavailable: "That exercise isn't available",
  retired: "That exercise has been retired and can't be added",
  unconfirmed: "Couldn't confirm that exercise was added — check your workout before adding it again",

  /** The "Other (5xx, 429, unknown 409, workout-finished)" column of §5.4, per route. */
  retry: Object.freeze({
    "create-set": "Couldn't add the set — try again",
    "update-set": "Couldn't save the set — try again",
    "delete-set": "Couldn't delete the set — try again",
    "move-exercise": "Couldn't move that exercise — try again",
    regroup: "Couldn't change the superset — try again",
    "remove-exercise": "Couldn't remove that exercise — try again",
    "update-note": "Couldn't save the note — try again",
    "update-details": "Couldn't save the details — try again",
  }),
  /** A 422 whose field errors match no field. */
  fieldsFallback: Object.freeze({
    "create-set": "Couldn't add the set — check the values and try again",
    "update-set": "Couldn't save the set — check the values and try again",
    "update-details": "Check the details and try again.",
  }),

  lastSet: Object.freeze({
    title: "Delete this whole workout instead?",
    body: "A workout can't be left with no sets. Deleting it also removes it from History and Progress, and any records it holds.",
    confirm: "Delete workout",
    cancel: "Keep it",
  }),

  setAdded: (n: number) => `Set ${n} added`,
  setSaved: (n: number) => `Set ${n} saved`,
  setDeleted: "Set deleted",
  exerciseAdded: (name: string) => `Exercise added: ${name}`,
  detailsSaved: "Details saved",

  /** §5.7, the workout's title and notes. */
  details: Object.freeze({
    heading: "Details",
    edit: "Edit details",
    noTitle: "No title",
    noNotes: "No notes",
    title: "Title",
    notes: "Notes",
    save: "Save details",
    titleTooLong: "Title can be at most 120 characters.",
    notesTooLong: "Notes can be at most 4000 characters.",
    control: "Remove characters that can't be saved.",
    other: "Check the details and try again.",
  }),
  exerciseRemoved: "Exercise removed",
  firstExercise: "Add your first exercise",

  /** §5.6, Change Time (Phase B). */
  timeFuture: "The start can't be in the future.",
  timeFloor: "The start can't be before 2000.",
  timeEndsInFuture: "That would end in the future. Choose an earlier start or a shorter time.",
  tookRequired: "Enter how long it took.",
  tookWhole: "Use whole numbers: hours 0–24, minutes 0–59.",
  tookMax: "Took can be at most 24 hours.",
  pickDay: "Pick a day.",
  pickTime: "Pick a time.",
  timeGeneric: "Check the time and try again.",
  changeTimeFailed: "Couldn't change the time — try again",
  timeChanged: "Time changed",
  tookHint: "Leave empty and Finish ends the workout when you tap it.",
});
