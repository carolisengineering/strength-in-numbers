import { createContext } from "react";

/**
 * Spec 17.10: the elements of a `Sheet`'s bottom row that `SheetActions` portals into. Each is null until the
 * row has mounted.
 */
export interface SheetSlots {
  danger: HTMLElement | null;
  primary: HTMLElement | null;
  status: HTMLElement | null;
  notice: HTMLElement | null;
}

export const SheetSlotsContext = createContext<SheetSlots | null>(null);
