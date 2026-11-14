import { useContext, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { InlineNotice } from "./InlineNotice";
import { SheetSlotsContext, type SheetSlots } from "./sheetSlots";

/** A save failure for `SheetActions`: build one with `sheetError` when the failure happens, never during render. */
export interface SheetError {
  readonly text: string;
  /** A request ID shown under the failure, for support (Spec 04.1's pattern). */
  readonly requestId?: string | null;
}

/** A new failure: a new object on every call, so the same words twice are two announcements (minor 558). */
export function sheetError(text: string, requestId?: string | null): SheetError {
  return { text, requestId: requestId ?? null };
}

export interface SheetActionsProps {
  /** The sheet's one primary action, last in the row. A submit button names its form with `form={id}`. */
  primary?: ReactNode;
  /** A destructive action, first in the row (Delete set, Remove section). */
  danger?: ReactNode;
  /** One muted line centered above the buttons; not a live region unless the caller makes it one. */
  status?: ReactNode;
  /**
   * A save failure, shown above `status` so it stays in view however far the body is scrolled. It fills the sheet's
   * always-mounted live region in `InlineNotice`'s error look (minors 496, 502, 503); `null` is none. A new object is a
   * new failure: the region empties for one commit and fills again, so the same words are announced again (minor 558).
   * Build it with `sheetError` when the failure happens, never during render. (A string is the pre-558 form, kept only
   * until every sheet passes a `SheetError`.)
   */
  error?: SheetError | string | null;
  /** A request ID shown under the failure, for support (Spec 04.1's pattern). */
  errorRequestId?: string | null;
}

/**
 * Spec 17.10 AC1: puts a sheet's buttons into its `Sheet`'s bottom row. Rendered where the sheet's state lives,
 * so handlers, refs and `aria-*` stay on the caller's own buttons; a portal moves them into the row. Renders
 * nothing until the row's slots exist (they appear in the same commit, before paint).
 */
export function SheetActions({ primary, danger, status, error, errorRequestId }: SheetActionsProps) {
  const slots = useContext(SheetSlotsContext);
  if (!slots) throw new Error("SheetActions must be inside a Sheet");
  const shown = useShownFailure(error);
  const text = typeof shown === "string" ? shown : shown?.text;
  const requestId = typeof shown === "string" ? errorRequestId : shown?.requestId;
  return (
    <>
      {portal(
        slots,
        "error",
        text ? (
          <InlineNotice tone="error" live={false} requestId={requestId ?? null}>
            {text}
          </InlineNotice>
        ) : null,
      )}
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

/**
 * Minor 558: what the error region shows. A value other than the one shown renders empty first; an effect, which runs
 * after that empty commit is painted, then shows it, so a screen reader hears the same words again. The same value on a
 * re-render changes nothing. Exported for its test.
 */
export function useShownFailure(error: SheetError | string | null | undefined): SheetError | string | null {
  const value = error ? error : null;
  const [shown, setShown] = useState(value);
  useEffect(() => setShown(value), [value]);
  return value === shown ? shown : null;
}
