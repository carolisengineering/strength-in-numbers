import type { HevyImportDropCode, HevyImportNoticeCode, HevyImportOutcome, HevyRoutineNoticeCode } from "@sin/core";

import type { ReadStage } from "./constants";

/**
 * Spec 20.1 §6.11: every user-visible string of the import. Copied verbatim from the spec where it fixes the text;
 * the rest is plan copy (marked), which Carol may change in review. Hevy's own text and workout titles never go in
 * a sentence here; titles appear only in the lists, as text.
 */

const fmt = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, one: string, many: string) => `${fmt(n)} ${n === 1 ? one : many}`;

/** §5: the step names, in order. */
export const STEP_LABELS = Object.freeze({
  read: "Read",
  routines: "Routines",
  names: "Names",
  summary: "Summary",
  import: "Import",
  done: "Done",
} as const);
export const STEPS_NAV_LABEL = "Import steps";

/** AC1: the Hevy screen's card and the route without a key. */
export const IMPORT_CARD_TITLE = "Import from Hevy";
// Plan copy.
export const IMPORT_CARD_BODY = "Bring your Hevy workouts, the routines you pick and your custom exercises into Strength in Numbers.";
export const ADD_KEY_FIRST = "Add your Hevy key first";

/** AC2 / §5.1: the preflight. */
export const IMPORT_TITLE = "Import from Hevy";
export const BACK_TO_HEVY = "Back to Hevy";
export const PREFLIGHT_INTRO = "This reads all your Hevy workouts, then shows what it will do before anything is written.";
export const PREFLIGHT_TIME = "Takes a few minutes. Keep this tab open and stay online.";
export const preflightZone = (zone: string) => `Dates use this device's time zone: ${zone}.`;
// Plan copy (AC2: "says so with a link to Profile").
export const preflightZoneDiffers = (profileZone: string) =>
  `Your Profile time zone is ${profileZone}. Change Time uses the Profile zone, so check it in Profile if you travel.`;
export const PROFILE_LINK = "Profile";
export const preflightUnit = (unit: "kg" | "lb") => `Weights are stored in ${unit} (your Profile setting).`;
export const PREFLIGHT_SAFE = "It is safe to run again: anything already imported is skipped.";
export const START = "Start";
// Plan copy.
export const PREFLIGHT_TITLE = "Before you start";
export const READING_TITLE = "Reading Hevy";
export const PREPARING = "Getting your pairings…";
export const PREPARING_FAILED = "Couldn't load your exercises and pairings. Check your connection and try again.";

/** AC2 / AC22: the stale-records banner. */
// Plan copy.
export const STALE_RECORDS = "Your last import didn't finish updating your records.";
export const FINISH_LAST_STEP = "Finish the last step";
export const FINISHING = "Updating your records…";
export const RECORDS_UPDATED = "Records updated.";
export const FINISH_FAILED = "Your workouts are in, but updating your records didn't finish.";

/** AC3 / §5.2: reading. */
const STAGE_NAMES: Readonly<Record<ReadStage, string>> = Object.freeze({
  count: "counting workouts",
  templates: "exercises",
  folders: "routine folders",
  routines: "routines",
  workouts: "workouts",
});
export const readingLine = (stage: ReadStage, page: number, pageCount: number) =>
  stage === "count" || pageCount === 0
    ? `Reading Hevy… ${STAGE_NAMES[stage]}`
    : `Reading Hevy… ${STAGE_NAMES[stage]}, page ${fmt(page)} of ${fmt(pageCount)}`;
export const CANCEL = "Cancel";
export const TRY_AGAIN = "Try again";
export const BACK = "Back";
export const CONTINUE = "Continue";

/** AC4: reconciliation. */
export const reconcileLine = (reported: number, read: number) =>
  `Hevy reported ${fmt(reported)} workouts but sent ${fmt(read)}. Workouts added or removed while reading can cause this; run the import again later to catch up.`;

/** AC5: read failures (the kind sentences come from 20.0's `HEVY_COPY`). */
export const READ_FAILED = "Couldn't finish reading Hevy";
// Plan copy.
export const readFailedStage = (stage: ReadStage) => `It stopped while reading ${STAGE_NAMES[stage]}.`;

/** AC7 / §5.3: routines. */
export const ROUTINES_TITLE = "Routines to copy";
export const routinesRoom = (used: number, max: number, room: number) =>
  `You have ${fmt(used)} of ${fmt(max)} routines; room for ${fmt(room)} more.`;
export const routinesChosen = (n: number) => `${plural(n, "routine", "routines")} chosen`;
export const NO_FOLDER = "No folder";
export const TICK_ALL = "Tick all in this folder";
export const exerciseCount = (n: number) => plural(n, "exercise", "exercises");
export const ROUTINE_EXISTS = "Already in your routines";
export const ROUTINE_SAME_NAME = "Same name as one you chose";
// Plan copy.
export const ROUTINE_NO_ROOM = "No room for more routines";

/** AC8: section markers. */
export const MARKERS_TITLE = "Section markers";
export const MARKERS_NEEDED =
  "Your Hevy workouts use Warmup and workout exercises as section markers. Choose them so they aren't imported as exercises.";
// Plan copy.
export const CHOOSE_MARKERS = "Choose markers";
export const SKIP = "Skip";

/** AC9 / AC10: names. */
// Plan copy.
export const NAMES_TITLE = "Pair exercises";
export const createsLine = (creates: number, room: number) =>
  `This would create ${plural(creates, "exercise", "exercises")}; you can add ${fmt(room)} more`;
export const creatingLine = (created: number, total: number) => `Creating exercises… ${fmt(created)} of ${fmt(total)}`;

/** AC11: checking (the dry run). */
// Plan copy.
export const CHECKING_TITLE = "Checking";
export const checkingLine = (done: number, total: number) => `Checking your workouts… ${fmt(done)} of ${fmt(total)}`;
export const REPLY_NOT_UNDERSTOOD = "The server's reply wasn't understood.";
// Plan copy.
export const CHECK_FAILED = "Couldn't check your workouts. Try again.";
export const CHECK_OFFLINE = "Couldn't reach the server. Check your connection and try again.";

/** AC12 / §5.5: the summary. */
export const SUMMARY_TITLE = "Summary";
export const workoutsRead = (n: number) => `${plural(n, "workout", "workouts")} read`;
export const SUMMARY_LABELS = Object.freeze({
  create: "will be imported",
  alreadyInSin: "already in SIN",
  sentFromSin: "sent from SIN earlier",
  duplicate: "already match a workout in SIN (they'll be linked, not copied)",
  deletedInSin: "deleted in SIN earlier",
  cannotImport: "can't be imported",
  unpaired: "waiting for a pairing",
} as const);
export const setsLine = (kept: number, dropped: number) => `Sets: ${fmt(kept)} kept, ${fmt(dropped)} dropped`;
export const routinesChosenLine = (n: number) => `${plural(n, "routine", "routines")} will be created.`;
export const exercisesCreatedLine = (n: number) => `${plural(n, "exercise was", "exercises were")} created while pairing.`;
export const NOTHING_WRITTEN = "Nothing has been written yet.";
export const SHOW_MORE = "Show 50 more";
export const LIST_GROUP_LABELS = Object.freeze({
  duplicate: "Matches a workout in SIN",
  cannot_import: "Can't be imported",
  sets_dropped: "Sets dropped",
  unpaired: "Waiting for a pairing",
} as const);
export const UNTITLED = "Untitled";
// Plan copy.
export const unpairedLine = (n: number) =>
  `${plural(n, "Hevy exercise isn't", "Hevy exercises aren't")} paired, so the workouts that use them can't be imported yet.`;
export const BACK_TO_NAMES = "Back to names";

/** AC13 / AC14: confirm. */
export const importLabel = (workouts: number, routines: number) =>
  `Import ${plural(workouts, "workout", "workouts")}${routines > 0 ? ` and ${plural(routines, "routine", "routines")}` : ""}`;
export const NOTHING_NEW = "Nothing new to import";
export const DONE = "Done";

/** AC28: why Import can't start. */
// Plan copy.
export const MAPPING_UNAVAILABLE = "Couldn't load your pairings. Check your connection and try again.";
export const IMPORT_UNAVAILABLE = "The Hevy import isn't available on this account";

/** AC16–AC20 / §5.6: the run. */
// Plan copy.
export const RUN_TITLE = "Importing";
export const runningLine = (sent: number, total: number, skipped: number) =>
  `Importing… ${fmt(sent)} of ${fmt(total)}${skipped > 0 ? ` · ${fmt(skipped)} skipped` : ""}`;
export const KEEP_TAB_OPEN = "Keep this tab open.";
export const STOP = "Stop";
export const STOPPING = "Stopping after this batch…";
export const RESUME = "Resume";
export const FINISH_UP = "Finish up";
export const PAUSED = "Paused: couldn't reach the server. Everything imported so far is saved.";
// Plan copy.
export const BACK_ONLINE = "You're back online.";
export const STOPPED_TITLE = "Stopped";
// Plan copy.
export const stoppedLine = (sent: number, total: number) => `${fmt(sent)} of ${plural(total, "workout", "workouts")} sent. What's imported so far stays.`;
export const STOP_INVALID = "The server didn't accept a workout in this batch.";
export const stopInvalidPath = (path: string) => `Field: ${path}`;
export const STOP_GATE = IMPORT_UNAVAILABLE;
export const STOP_AUTH = "Your session ended. Sign in again, then run the import again.";

/** AC20: the leave guard. */
export const LEAVE_TITLE = "Stop the import?";
export const LEAVE_BODY = "What's imported so far stays, and you can run it again.";
// Plan copy.
export const LEAVE_CONFIRM = "Stop and leave";

/** AC23: the routines step. */
// Plan copy.
export const ROUTINES_RUN_TITLE = "Creating routines";
export const creatingRoutinesLine = (done: number, total: number) => `Creating routines… ${fmt(done)} of ${fmt(total)}`;

/** AC25 / §5.7: the done screen. */
export const DONE_TITLE = "Done";
export const VIEW_HISTORY = "View History";
export const DOWNLOAD_REPORT = "Download report";

/** AC28: the summary went stale. */
// Plan copy.
export const SUMMARY_STALE = "Your pairings changed. Check again before importing.";
export const CHECK_AGAIN = "Check again";

/** AC12: what happened to a workout (19.1 AC1). Plan copy. */
export const OUTCOME_LABELS: Readonly<Record<HevyImportOutcome, string>> = Object.freeze({
  create: "Will be imported",
  already_imported: "Already imported",
  sent_from_sin: "Sent from SIN earlier",
  already_matched: "Already linked to a SIN workout",
  deleted_in_sin: "Deleted in SIN earlier",
  duplicate: "Matches a workout already in SIN",
  unpaired: "Uses an exercise that isn't paired",
  no_usable_sets: "No sets could be kept",
  time_invalid: "Its start or end time can't be used",
  rejected: "The server couldn't save it",
});

/** AC12: why sets were dropped (19.1 AC1). Plan copy. */
export const DROP_LABELS: Readonly<Record<HevyImportDropCode, string>> = Object.freeze({
  exercise_skipped: "An exercise you chose to skip",
  exercise_no_sets: "An exercise with no sets left",
  set_missing_measure: "A set was missing a number this exercise needs",
  set_forbidden_measure: "A set had a number this exercise can't record",
  set_out_of_range: "A set had a number out of range",
});

/** What the import changed without dropping a set (19.1 AC1). Plan copy. */
export const NOTICE_LABELS: Readonly<Record<HevyImportNoticeCode, string>> = Object.freeze({
  custom_metric_ignored: "A custom number was left out",
  assist_weight_ignored: "An assistance weight was left out",
  placeholder_sets_ignored: "Sets on a section marker were left out",
  section_empty: "An empty section was left out",
  sections_over_limit: "Sections over the limit were merged",
  section_name_trimmed: "A section name was shortened",
  section_notes_trimmed: "Section notes were shortened",
  superset_over_limit: "Supersets over the limit were split",
  title_trimmed: "The title was shortened",
  notes_trimmed: "Notes were shortened",
});

/** What a routine translation changed (19.1 AC11). Plan copy. */
export const ROUTINE_NOTICE_LABELS: Readonly<Record<HevyRoutineNoticeCode, string>> = Object.freeze({
  name_trimmed: "The name was shortened",
  items_cut: "Exercises over the limit were left out",
  rest_clamped: "A rest time was brought into range",
  superset_cut: "A superset was split",
  time_targets_not_kept: "Time targets weren't kept",
  distance_targets_not_kept: "Distance targets weren't kept",
  sets_cut: "Sets over the limit were left out",
  notes_trimmed: "Notes were shortened",
  section_empty: "An empty section was left out",
  sections_over_limit: "Sections over the limit were merged",
  section_name_trimmed: "A section name was shortened",
  section_notes_trimmed: "Section notes were shortened",
});

/** AC6 / D9: a workout the request can't carry (an unknown set type, or over the request's limits; O2). Plan copy. */
export const UNREADABLE_LABEL = "Hevy sent something this import can't read";
