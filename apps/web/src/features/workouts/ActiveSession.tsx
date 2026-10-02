import type { WorkoutDetail } from "@sin/core";

import { InlineNotice } from "../../ui/InlineNotice";
import { Screen } from "../../ui/Screen";

export interface ActiveSessionProps {
  workout: WorkoutDetail;
  /** A one-line message carried over from another screen (e.g. "…resumed it."). */
  notice?: string | null;
  /** The workout is gone or finished elsewhere: hand back to the Workouts screen (§5.8 gone path). */
  onGone: () => void;
}

/** Stand-in until Task 12 builds the real session screen. */
export function ActiveSession({ notice }: ActiveSessionProps) {
  return <Screen title="Workout">{notice ? <InlineNotice>{notice}</InlineNotice> : null}</Screen>;
}
