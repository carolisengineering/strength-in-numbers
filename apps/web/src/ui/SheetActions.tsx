import { useContext, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { SheetSlotsContext, type SheetSlots } from "./sheetSlots";

export interface SheetActionsProps {
  /** The sheet's one primary action, last in the row. A submit button names its form with `form={id}`. */
  primary?: ReactNode;
  /** A destructive action, first in the row (Delete set, Remove section). */
  danger?: ReactNode;
  /** One muted line centered above the buttons; not a live region unless the caller makes it one. */
  status?: ReactNode;
  /** A save failure, shown above `status` so it stays in view however far the body is scrolled. */
  notice?: ReactNode;
}

/**
 * Spec 17.10 AC1: puts a sheet's buttons into its `Sheet`'s bottom row. Rendered where the sheet's state lives,
 * so handlers, refs and `aria-*` stay on the caller's own buttons; a portal moves them into the row. Renders
 * nothing until the row's slots exist (they appear in the same commit, before paint).
 */
export function SheetActions({ primary, danger, status, notice }: SheetActionsProps) {
  const slots = useContext(SheetSlotsContext);
  if (!slots) throw new Error("SheetActions must be inside a Sheet");
  return (
    <>
      {portal(slots, "notice", notice)}
      {portal(slots, "status", status)}
      {portal(slots, "danger", danger)}
      {portal(slots, "primary", primary)}
    </>
  );
}

function portal(slots: SheetSlots, slot: keyof SheetSlots, content: ReactNode) {
  const target = slots[slot];
  return content != null && content !== false && target ? createPortal(content, target) : null;
}
