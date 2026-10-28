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
export const MAPPING_RATE_LIMITED = "Too many changes in a short time — wait a minute and try again";
// Plan copy.
export const MAPPING_SAVE_FAILED = "Couldn't save the pairings. Try again.";
export const COUNT_CALORIES = "Count calories as reps";
export const IGNORE_ASSIST = "Ignore the assist weight";
export const willBePaired = (n: number) => `Will be paired: ${n}`;
export const leftOutHeading = (n: number) => `Left out: ${n}`;
export const lineLabel = (n: number) => `Line ${n}`;
export const SECTIONS_HEADING = "Section rules and placeholders";
export const willBeRemovedLine = (n: number) => `${n} pairings in the app that are not in this file`;
export const SHOW_LIST = "Show the list";
export const needsRuleLine = (hevyTitle: string, sinName: string) => `${hevyTitle} with ${sinName} needs one more choice:`;
export const placeholderMissing = (which: "warmup" | "workout") =>
  `The ${which === "warmup" ? "Warmup" : "workout"} marker in the file wasn't found in Hevy.`;
export const typeMismatch = (hevyTitle: string, sinName: string) => `${hevyTitle} can't be paired with ${sinName}: the types don't match`;

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
});
