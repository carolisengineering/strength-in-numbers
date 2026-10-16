import { createContext, useContext } from "react";
import type { DraftStores } from "./draftStore";

/** Supplied by `WorkoutClientProvider`; `null` where none is mounted (a bare component test). */
export const DraftStoresContext = createContext<DraftStores | null>(null);

export function useDraftStores(): DraftStores | null {
  return useContext(DraftStoresContext);
}
