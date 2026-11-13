import type { queries} from "@testing-library/react";
import { waitFor, within, type BoundFunctions } from "@testing-library/react";

/**
 * Spec 17.10: the open sheet's bottom action row (danger, dismiss, primary). Vitest processes no CSS Modules
 * classes, so this finds the row by its `data-sheet-actions` hook.
 */
export function sheetRow(): BoundFunctions<typeof queries> {
  return within(sheetPart("[data-sheet-actions]"));
}

/** Spec 17.10: the open sheet's scrolling body (its children; never the row). */
export function sheetBody(): HTMLElement {
  return sheetPart("[data-sheet-body]");
}

function sheetPart(selector: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`dialog[open] ${selector}`);
  if (!element) throw new Error(`No open sheet has ${selector}`);
  return element;
}


/** Minors 496, 502: the open sheet's save-failure text (its always-mounted live region), or "" when there is none. */
export function sheetError(): string {
  return sheetPart("[data-sheet-error]").textContent ?? "";
}

/** Minors 496, 502: the open sheet's save-failure live region (always mounted; empty until a failure). */
export function sheetErrorRegion(): HTMLElement {
  return sheetPart("[data-sheet-error]");
}

/** Waits until the open sheet's save-failure region holds text, and returns it. */
export async function findSheetError(): Promise<HTMLElement> {
  let region: HTMLElement | null = null;
  await waitFor(() => {
    region = sheetErrorRegion();
    if (!/\S/.test(region.textContent ?? "")) throw new Error("No save failure in the open sheet");
  });
  return region!;
}
