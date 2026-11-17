import { createContext, useContext } from "react";

/**
 * Spec 17.12 §6.3: which pane a screen is drawn in, and the pane layout's selected id. `slot` is `null` outside
 * `Panes` and below 64rem, where `Panes` draws only today's screen, so `Screen` and `BackLink` behave as they always
 * have; `"list"` titles the screen with an `h2`, and `"detail"` hides `BackLink` (the list beside it is the way back).
 */
export interface PaneValue {
  slot: "list" | "detail" | null;
  /** The derived selection (`useSelectedId`): it marks the list's row and picks the detail, so they never disagree. */
  selectedId: string | null;
}

export const PaneContext = createContext<PaneValue>({ slot: null, selectedId: null });

export function usePane(): PaneValue {
  return useContext(PaneContext);
}
