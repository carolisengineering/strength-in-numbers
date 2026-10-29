import { waitText } from "../../ui/waitText";
import type { MappingCsvErrorCode } from "@sin/core";

import type { HevyErrorKind } from "./client/hevyErrors";
import type { LeftOutReason } from "./mapping/resolveLines";

/**
 * Spec 20.0: every user-visible Hevy string. Copied verbatim from the spec where it fixes the text; the rest is
 * plan copy (marked), which Carol may change in review.
 */

/** AC5 / AC9: one sentence per error kind. */
export const HEVY_COPY: Readonly<Record<HevyErrorKind, string>> = Object.freeze({
  bad_key: "Hevy didn't accept that key. Check that it's a current key from a Hevy Pro account.",
  network: "Couldn't reach Hevy. Check your connection and try again.",
  unexpected_reply: "Hevy's reply wasn't understood.",
  limit: "Your Hevy account has reached its custom exercise limit.",
  // Plan copy.
  rate_limited: "Hevy asked us to slow down. Try again in a minute.",
  rejected: "Hevy didn't accept that request.",
  not_found: "Hevy couldn't find that.",
  server: "Hevy is having trouble right now. Try again later.",
  aborted: "Stopped.",
});

/** The key card (AC4–AC6, §5.1). */
export const KEY_CARD_TITLE = "Hevy key";
export const KEY_LABEL = "Hevy API key";
export const KEY_HELPER = "Find it in Hevy: Settings, then Developer (Hevy Pro).";
export const KEY_STAYS = "The key stays on this device. It is never sent to Strength in Numbers.";
export const KEY_SHAPE_ERROR = "That doesn't look like a Hevy key.";
export const KEY_NOT_PRO = "This key is from a Hevy account without Pro, so Hevy's API won't work. Nothing was saved.";
export const keyEnding = (last4: string) => `Hevy key ending ••••${last4}`;
export const signedInAs = (username: string) => `Signed in to Hevy as ${username}`;
export const REMOVE_TITLE = "Remove the Hevy key from this device?";
export const SAVE_AND_REMEMBER = "Save and remember";
export const USE_FOR_VISIT = "Use for this visit only";
export const REPLACE = "Replace";
export const REMOVE = "Remove";
// Plan copy.
export const CANCEL = "Cancel";
export const REMOVE_BODY = "You can paste it again any time.";
export const KEY_SAVED = "Hevy key saved.";
export const KEY_SAVED_VISIT = "Hevy key saved for this visit only.";
export const KEY_REMOVED = "Hevy key removed.";
export const KEY_NOT_REMEMBERED = "This browser couldn't remember the key, so it's kept for this visit only.";

/** Phase B: the mapping card (AC17, §5.1). */
export const MAPPING_CARD_TITLE = "Exercise pairings";
export const pairedCount = (n: number) => `${n} exercises paired`;
export const markersLine = (names: readonly string[]) => `Section markers: ${names.join(", ")}`;
export const NO_MARKERS = "Section markers aren't set up. Sections will go into the first exercise's notes.";
export const LOAD_FILE = "Load a file";
export const DOWNLOAD_FILE = "Download file";
export const REVIEW_PAIRINGS = "Review pairings";
export const CHOOSE_MARKERS = "Choose them";
export const CHANGE_MARKERS = "Change markers";
export const REPLACE_PAIRING_TITLE = "Use as a marker instead?";
export const USE_AS_MARKER = "Use as marker";
export const replaceExercisePairing = (title: string, exerciseName: string) => `${title} is paired with ${exerciseName}. Use it as a marker instead?`;
// Plan copy.
export const MAPPING_LOADING = "Loading your pairings…";
export const MAPPING_LOAD_FAILED = "Couldn't load your pairings. Try again.";
export const DOWNLOAD_FAILED = "Couldn't download the file. Try again.";

/** Phase B: loading a file (AC18–AC22, §5.2). */
export const LOAD_SHEET_TITLE = "Load a mapping file";
export const NO_KEY_FOR_FILE = "Add your Hevy key first";
export const FILE_FORMAT_LINE = "A CSV file of pairings, like the one Download file gives you.";
export const WHATS_IN_FILE = "What's in the file?";
export const FILE_COLUMNS = "kind, hevy_id, hevy_title, sin_id, sin_name, rule, export_as";
export const CHOOSE_FILE = "Choose a file";
export const FILE_TOO_BIG = "That file is too big to be a mapping.";
export const readingTemplates = (page: number, pageCount: number) => `Reading Hevy's exercise list… page ${page} of ${pageCount}`;
export const CHECKING_FILE = "Checking your file…";
export const CANCEL_LOAD = "Cancel";
export const loadButton = (n: number) => `Load ${n} pairings`;
export const leaveOutNote = (m: number) => `leave out ${m} lines`;
export const loaded = (n: number) => `Loaded ${n} pairings.`;
export const MAPPING_REJECTED = "The server didn't accept this mapping";
// Copied from routines/messages.ts (OFFLINE_SAVE, RATE_LIMITED), not imported: Hevy imports nothing from routines (AC31).
export const MAPPING_OFFLINE = "You're offline — your changes are still here, try again when connected";
export const QUIET_MINUTE = "Hevy asks apps to wait during the first minute of each hour. This will go through shortly.";
export const LOADING_USERNAME = "Checking your Hevy account…";
/** Minor 181: a mapping write's 429, with how long to wait. */
export const mappingRateLimited = (retryAfterMs: number | null | undefined) => `Too many changes in a short time. ${waitText(retryAfterMs)}`;
// Plan copy.
export const MAPPING_SAVE_FAILED = "Couldn't save the pairings. Try again.";
export const COUNT_CALORIES = "Count calories as reps";
export const IGNORE_ASSIST = "Ignore the assist weight";
export const willBePaired = (n: number) => `Will be paired: ${n}`;
export const leftOutHeading = (n: number) => `Left out: ${n}`;
export const lineLabel = (n: number) => `Line ${n}`;
export const SECTIONS_HEADING = "Section rules and placeholders";
export const willBeRemovedLine = (n: number) => `${n} pairings in the app that are not in this file`;
export const willChangeLine = (n: number) => `${n} pairings in the app that this file changes`;
export const NOTICES_LABEL = "Notices";
export const CATALOG_NOT_READY = "Your exercise list hasn't loaded yet. Try again in a moment.";
export const idTitleNotice = (line: number) => `Line ${line}: the Hevy id and title name different exercises; the id was used`;
export const exportAsTwiceNotice = (line: number) => `Line ${line}: another line already sends this exercise to Hevy, so this one won't`;
export const SHOW_LIST = "Show the list";
export const needsRuleLine = (hevyTitle: string, sinName: string) => `${hevyTitle} with ${sinName} needs one more choice:`;
export const placeholderMissing = (which: "warmup" | "workout") =>
  `The ${which === "warmup" ? "Warmup" : "workout"} marker in the file wasn't found in Hevy.`;
export const typeMismatch = (hevyTitle: string, sinName: string) => `${hevyTitle} can't be paired with ${sinName}: the types don't match`;

/** Phase B: the section-marker sheet (AC30). The two labels are verbatim; the rest is plan copy. */
export const MARKERS_SHEET_TITLE = "Section markers";
export const MARKER_WARMUP = "Warmup";
export const MARKER_WORKOUT = "workout";
export const MARKER_NONE = "None";
export const SAVE_MARKERS = "Save markers";
export const SEARCH_HEVY_EXERCISES = "Search Hevy exercises";

/** Phase B: the Pairings screen (AC24, AC25, §5.3). */
export const PAIRINGS_TITLE = "Pairings";
export const BACK_TO_HEVY = "Back to Hevy";
export const SEARCH_EXERCISES = "Search exercises";
export const SENT_AS_THIS = "Sent as this";
export const SEND_AS_THIS = "Send as this";
export const REMOVE_PAIRING = "Remove pairing";
export const deletedHeading = (n: number) => `Exercises you deleted (${n})`;
export const skippedHeading = (n: number) => `Skipped in Hevy (${n})`;
export const markersHeading = (n: number) => `Section markers (${n})`;
export const lastPairingBody = (name: string) => `${name} won't be sent to Hevy until you pair it again.`;
// Plan copy.
export const REMOVE_PAIRING_TITLE = "Remove this pairing?";
export const removePairingBody = (hevyTitle: string) => `${hevyTitle} will no longer be paired.`;
export const UNNAMED_EXERCISE = "A deleted exercise";
export const PAIRINGS_PATCH_FAILED = "Couldn't change that pairing. Try again.";
export const NO_PAIRINGS = "No pairings yet. Load a file on the Hevy screen.";

/** Phase B: the pairing cards (AC26, AC27, §5.4). Verbatim from §5.4 unless marked. */
export const EXACT_MATCH = "exact match";
export const SIMILAR_MATCH = "similar";
export const CHOOSE_ANOTHER = "Choose another…";
export const NEW_EXERCISE = "New exercise";
export const SKIP_EXERCISE = "Skip this exercise (its sets are not imported)";
export const CALORIES_RULE = "Count calories as reps (Hevy has no calories field; your numbers are stored as reps there)";
export const NO_LONGER_IN_HEVY = "No longer in Hevy";
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
export const usedIn = (workouts: number, routines: number) =>
  routines === 0 ? `Used in ${plural(workouts, "workout")}` : `${plural(workouts, "workout")}, ${plural(routines, "routine")}`;
// Plan copy.
export const ASSIST_RULE = "Ignore the assist weight";
export const FILE_READ_FAILED = "Couldn't read that file. Choose it again.";
/** Minor 200: one rule reads singular. */
export const sectionRulesRemovedLine = (n: number) =>
  n === 1 ? "1 section rule in the app that this file drops or changes" : `${n} section rules in the app that this file drops or changes`;
export const SECTION_RULES_DROPPED_LABEL = "Section rules dropped";
export const markerLine = (which: "warmup" | "workout", title: string) => `${which === "warmup" ? "Warmup marker" : "Workout marker"}: ${title}`;
export const PAIRINGS_LOADING = "Loading your exercises…";
export const sentAsDone = (title: string) => `${title} is now sent to Hevy.`;
export const removedDone = (title: string) => `Removed ${title}.`;
export const RULE_NOT_ALLOWED = "Untick the box above to pair these.";
export const RULE_NEEDED = "Tick the box above to pair these, or choose another exercise.";
export const typeProblem = (hevyLabel: string, modalityLabel: string) => `A ${hevyLabel} exercise can't be paired with a ${modalityLabel} one.`;
export const SAME_NEW_NAME = "Another card makes an exercise with this name.";
export const newNameExists = (name: string) => `You already have “${name}”. Choose it instead of making a new one.`;
export const NEW_INVALID = "Check this exercise's type and details";
export const PAIRING_GONE = "That exercise is no longer in your list. Choose another.";
export const UNSUPPORTED_TYPE = "Strength in Numbers can't store this Hevy exercise's type. Skip it.";
export const createFailed = (name: string) => `Couldn't create “${name}”. Nothing was paired.`;

/** AC18: one sentence per file error, shown as "Line n: …" (plan copy). */
export const CSV_ERROR_COPY: Readonly<Record<MappingCsvErrorCode, string>> = Object.freeze({
  bad_header: "The first line must be the column names: kind, hevy_id, hevy_title, sin_id, sin_name, rule, export_as.",
  unknown_kind: "The kind must be exercise, skip, placeholder or section.",
  missing_column: "This line is missing a column.",
  bad_rule: "The rule isn't one this file can use.",
  bad_export_as: "export_as must be yes, no or blank.",
  no_hevy_ref: "This line needs a Hevy id or title.",
  no_sin_ref: "This line needs a Strength in Numbers id or name.",
  too_many_lines: FILE_TOO_BIG,
  file_too_large: FILE_TOO_BIG,
});

/** AC19: why a line was left out (plan copy; the type mismatch is its own sentence, `typeMismatch`). */
export const LEFT_OUT_COPY: Readonly<Record<LeftOutReason, string>> = Object.freeze({
  hevy_not_found: "not found in Hevy",
  sin_not_found: "not found in Strength in Numbers",
  hevy_ambiguous: "more than one Hevy exercise has this title",
  sin_ambiguous: "more than one exercise has this name",
  type_mismatch: "the types don't match",
  retired: "this exercise was deleted",
  duplicate: "this Hevy exercise is already on an earlier line",
  section_invalid: "a section named twice; only the first counts",
});
