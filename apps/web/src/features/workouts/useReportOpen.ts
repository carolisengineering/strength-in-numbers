import { useLayoutEffect } from "react";

/**
 * Minor 711: report an overlay's open state to the screen, so it counts the overlay for as long as it's open. Open and
 * closed are both reported; the cleanup reports a close, an unmount with the overlay open included. Minor 768: a layout
 * effect, so the screen's `overlayOpen` holds before the paint, and a sheet opened by an update that isn't a tap never
 * paints once with Undo still showing behind it.
 */
export function useReportOpen(open: boolean, onChange?: (open: boolean) => void): void {
  useLayoutEffect(() => {
    if (!open) return;
    onChange?.(true);
    return () => onChange?.(false);
  }, [open, onChange]);
}
