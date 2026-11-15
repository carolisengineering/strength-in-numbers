import type { SyntheticEvent } from "react";

/**
 * Spec 17.11 Phase A: the "Exercise details" disclosure's `onToggle`. It records only a change the page didn't make
 * (the element's `open` now differs from the state that drew it). React delivers a nested `<details>`'s toggle here too
 * (the Edit sheet's "More details"), so only the disclosure's own toggle counts (minor 508).
 */
export function disclosureToggle(open: boolean, setOpen: (open: boolean) => void): (event: SyntheticEvent<HTMLDetailsElement>) => void {
  return (event) => {
    if (event.target !== event.currentTarget) return;
    if (event.currentTarget.open !== open) setOpen(event.currentTarget.open);
  };
}
