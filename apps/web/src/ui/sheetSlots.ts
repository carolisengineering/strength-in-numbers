import { createContext } from "react";

/**
 * Spec 17.10: the elements of a `Sheet`'s bottom row that `SheetActions` portals into. Each is null until the
 * row has mounted.
 */
export interface SheetSlots {
  danger: HTMLElement | null;
  primary: HTMLElement | null;
  status: HTMLElement | null;
  /** Minors 496, 502: the save-failure live region, mounted empty from the start. */
  error: HTMLElement | null;
}

export const SheetSlotsContext = createContext<SheetSlots | null>(null);
