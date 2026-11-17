import { createContext, useContext } from "react";
import type { LandedStore } from "./landedStore";

/** Spec 06.7 AC27: the provider's landed store, for the Workouts screen's one-time line and the summary that clears it. */
export const LandedStoreContext = createContext<LandedStore | null>(null);

export function useLandedStore(): LandedStore | null {
  return useContext(LandedStoreContext);
}
