import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Spec 17.11 Phase B: a planned set is a collapsed line, a button named by its summary ("1 · Warm-up · 8 reps ·
 * 40 kg"), and only the open row draws its fields. Tests reach a row's fields through `openRow`.
 */
export function summaryButton(n: number, scope: HTMLElement = document.body): HTMLElement {
  return within(scope).getByRole("button", { name: new RegExp(`^${n} · `) });
}

/** Opens set `n` (1-based) unless it is already open. */
export async function openRow(user: UserEvent, n: number, scope?: HTMLElement): Promise<void> {
  const button = summaryButton(n, scope);
  if (button.getAttribute("aria-expanded") !== "true") await user.click(button);
}

/** The summary buttons of the plan list, in order. */
export function summaryButtons(): HTMLElement[] {
  const list = screen.getByRole("list", { name: "Planned sets" });
  return within(list).queryAllByRole("button", { name: /^\d+ · / });
}

/**
 * Tab stops inside `root` (Spec 17.11 AC15): enabled buttons and inputs, selects and textareas, with the radios that
 * share a `name` counted once (Tab enters a radio group once; arrows move within it).
 */
export function tabStops(root: HTMLElement): number {
  const radioNames = new Set<string>();
  let count = 0;
  for (const el of root.querySelectorAll<HTMLElement>("button, input, select, textarea")) {
    if ((el as HTMLButtonElement | HTMLInputElement).disabled || el.tabIndex < 0) continue;
    if (el instanceof HTMLInputElement && el.type === "radio") {
      if (radioNames.has(el.name)) continue;
      radioNames.add(el.name);
    }
    count += 1;
  }
  return count;
}
