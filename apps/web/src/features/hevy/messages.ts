import type { HevyErrorKind } from "./client/hevyErrors";

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
