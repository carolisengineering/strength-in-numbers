import { REFUSED_OTHER, refusedBlocked, refusedIncomplete } from "./outbox/finishMessages";
import { START_CLOCK_MESSAGE } from "./useBeginWorkout";

/** Spec 06.7 AC29: why a finish was refused, as the banner reads it. */
export type RefusedKind = "blocked" | "incomplete" | "clock" | "other";

/**
 * The refused banner's detail after `REFUSED_LEAD`, or `null` for the lead alone.
 * - `blocked`: the status line's count of refused rows (minor 697: "things" unless every one is a set).
 * - `incomplete`: the flagged count once this op's re-read has landed; before that the lead alone (minor 638), except
 *   with no signal, where the paused re-read may not land for a while, so it still says to tap Finish again (minor 692).
 */
export function refusedDetailFor(input: {
  kind: RefusedKind;
  rereadDone: boolean;
  flagged: number;
  online: boolean;
  refusedRows: number;
  refusedSets: number;
}): string | null {
  switch (input.kind) {
    case "blocked":
      return refusedBlocked(input.refusedRows, input.refusedSets);
    case "incomplete":
      if (!input.rereadDone) return input.online ? null : REFUSED_OTHER;
      return input.flagged > 0 ? refusedIncomplete(input.flagged) : REFUSED_OTHER;
    case "clock":
      return START_CLOCK_MESSAGE;
    case "other":
      return REFUSED_OTHER;
  }
}
