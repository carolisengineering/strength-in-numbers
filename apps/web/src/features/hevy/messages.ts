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
