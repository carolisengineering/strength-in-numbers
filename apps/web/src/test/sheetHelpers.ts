import type { queries} from "@testing-library/react";
import { within, type BoundFunctions } from "@testing-library/react";

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
