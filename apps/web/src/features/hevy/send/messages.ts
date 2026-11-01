import type { ExportNotice } from "@sin/core";

import type { HevyErrorKind } from "../client/hevyErrors";
import { HEVY_COPY } from "../messages";

/**
 * Spec 20.2 §6.6, AC19: every sentence of Send to Hevy. Verbatim from the AC that names it; the rest is plan copy
 * (marked). Hevy's own text, workout titles and exercise names never go in a sentence here, except a card naming its
 * own exercise (`left_out`). American English.
 */

const fmt = (n: number) => n.toLocaleString("en-US");

export const HEVY_SEND_COPY = Object.freeze({
  heading: "Hevy",
  // AC2: the section's states.
  notYet: "Not in Hevy yet.",
  sending: "Sending to Hevy…",
  sent: "Sent to Hevy",
  fromHevy: "From Hevy",
  matched: "Matched with a Hevy workout",
  changed: "Changed since sent to Hevy",
  // AC3.
  noKey: "Add your Hevy key in Profile to send workouts.",
  // Plan copy: the AC3 link.
  noKeyLink: "Go to Hevy settings",
  // AC6–AC12.
  inProgress: "Another send is in progress. Try again in a minute.",
  inconclusive: "Not sure whether an earlier send reached Hevy.",
  notSure: "Not sure whether Hevy received it. Check before sending again.",
  notSureUpdate: "Not sure whether Hevy updated it.",
  couldntRecord: "Sent to Hevy, but this app couldn't record it. Tap Try again; it won't send again.",
  alreadyLinked: "This Hevy workout is already linked to another workout here.",
  foundIt: "Found it in Hevy; linked.",
  copyGone: "That workout isn't in Hevy any more.",
  // AC18.
  deleteNote: "This workout is also in Hevy. Deleting it here doesn't remove it from Hevy; delete it there yourself.",
  // Plan copy: a SIN-side failure that is not the network.
  generic: "Couldn't send this workout. Try again.",
  // Plan copy: the begin / complete refusals (`problemSentence`).
  notFinished: "This workout isn't finished yet.",
  noClaim: "The send was interrupted. Check this workout and try again.",
  // Plan copy (minor 257): the same refusal after Hevy took the write; Try again updates that copy.
  noClaimSent: "Sent to Hevy, but the send was interrupted. Tap Try again; it won't send a second copy.",
  // AC16 and AC14: 20.0's sentences, word for word.
  network: HEVY_COPY.network,
  templateLimit: HEVY_COPY.limit,
  // AC13 / AC14: the pairing sheet.
  matchTitle: "Match exercises for Hevy",
  usedHere: "used in this workout",
  createWarning: "Hevy can't edit or delete an exercise after it's created. Check the details.",
  // Buttons.
  send: "Send to Hevy",
  update: "Update in Hevy",
  checkHevy: "Check Hevy",
  checkAgain: "Check again",
  sendAnyway: "Send anyway",
  tryAgain: "Try again",
  sendAsNew: "Send as a new Hevy workout",
  continue: "Continue",
  cancel: "Cancel",
  pick: "Pick a Hevy exercise",
  create: "Create in Hevy",
  leaveOut: "Leave out of this workout",
  // AC23: the Hevy screen's switch (Phase B).
  autoPushLabel: "Send each workout to Hevy when I finish it",
  autoPushHelp: "Works while the app is open. If something can't be sent, the workout's screen has a Send to Hevy button.",
} as const);

/** AC25: shown above Send while auto-push is on and an unsent workout has unmatched exercises. */
export function needsMatching(n: number): string {
  return n === 1 ? "1 exercise needs matching before this can go to Hevy." : `${fmt(n)} exercises need matching before this can go to Hevy.`;
}

/** AC2: "Sent to Hevy · Sat 24 Oct" (and "From Hevy · …", "Matched with a Hevy workout · …"). */
export const withDay = (label: string, day: string | null) => (day === null ? label : `${label} · ${day}`);

/** AC8's own sentences for the definite failures; the rest are 20.0's (`network` is AC16's). */
const AC8: Partial<Record<HevyErrorKind, string>> = {
  rejected: "Hevy didn't accept this workout.",
  limit: "Your Hevy account has reached a limit.",
  bad_key: "Hevy didn't accept your key. Check it in Profile.",
};

export function hevyFailureSentence(kind: HevyErrorKind): string {
  return AC8[kind] ?? HEVY_COPY[kind];
}

/**
 * A notice the send shows once (AC15): 19.0's export notices, plus an exercise left out of this send (D2), and a
 * reclaim that updated another device's copy, so its own earlier copy stays in Hevy (D25, minor 270).
 */
export type SendNotice = ExportNotice | { code: "left_out"; name: string } | { code: "earlier_copy" };

const sets = (n: number) => `${fmt(n)} ${n === 1 ? "set" : "sets"}`;
const quoted = (names: readonly string[]) =>
  names.length <= 1 ? `'${names[0] ?? ""}'` : `${names.slice(0, -1).map((n) => `'${n}'`).join(", ")} and '${names[names.length - 1]}'`;

/** AC15: one short sentence per notice; counts and names are data. `title_fallback` is not shown. */
export function noticeSentence(notice: SendNotice): string | null {
  switch (notice.code) {
    case "left_out":
      return `${notice.name} was left out.`;
    case "earlier_copy":
      // Owner copy (Carol, 2026-11-01).
      return "An earlier copy is still in Hevy; delete it there.";
    case "sets_not_sent":
      return notice.count === 1 ? "1 set wasn't sent because it was incomplete." : `${sets(notice.count)} weren't sent because they were incomplete.`;
    case "rpe_dropped":
      return `RPE below 6 was left out of ${sets(notice.count)}.`;
    case "rpe_rounded":
      // Plan copy.
      return `RPE was rounded to Hevy's steps on ${sets(notice.count)}.`;
    case "distance_rounded":
      // Plan copy.
      return "Distances were rounded to whole meters.";
    case "section_no_placeholder": {
      const names = notice.names ?? [];
      return names.length > 1
        ? `Sections ${quoted(names)} had no marker exercise, so their notes went on the first exercise.`
        : `Section ${quoted(names)} had no marker exercise, so its note went on the first exercise.`;
    }
    case "title_fallback":
      return null;
  }
}
