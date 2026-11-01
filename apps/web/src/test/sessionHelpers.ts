import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";
import { vi } from "vitest";

import { DOUBLE_TAP_MS } from "../features/workouts/logAction";

/**
 * Session-screen selectors shared by every test file (Spec 17.1). A later task that moves a control changes the
 * helper here, so the suites' edits stay selector-only (AC34–AC37).
 */

/** An exercise, collapsed or current: its article keeps the exercise's name (or its superset label) either way. */
export const card = (name: string | RegExp): HTMLElement => screen.getByRole("article", { name });

/** AC11: tap a collapsed row to make it current; a no-op when it already is. Returns the re-queried card. */
export async function makeCurrent(user: UserEvent, name: string | RegExp): Promise<HTMLElement> {
  const heading = within(card(name)).getByRole("heading", { level: 2 });
  const collapsed = within(heading).queryByRole("button");
  if (collapsed !== null) await user.click(collapsed);
  return card(name);
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Spec 17.1 AC25: the bottom bar's button logs the current exercise; its name ends "for {exercise}". */
export const logButton = (name: string): HTMLElement =>
  within(screen.getByTestId("session-bar")).getByRole("button", { name: new RegExp(`^Log .* for ${escape(name)}$`) });

/** The card's Options toggle, "Options for {exercise}" (Spec 17.1 AC38); `name` is the card's name, so a superset card works too. */
export const optionsButton = (name: string | RegExp): HTMLElement => within(card(name)).getByRole("button", { name: /^Options for / });

/** Spec 18.0 AC3: the edit screen's bottom bar button, its one primary. */
export const editDoneButton = (): HTMLElement => within(screen.getByTestId("edit-bar")).getByRole("button", { name: "Done" });

/** Spec 18.0 AC8: a card's Add set button, named "Add set to {exercise}". */
export const addSetButton = (name: string | RegExp): HTMLElement => within(card(name)).getByRole("button", { name: /^Add set to / });

/** The control that opens the Finish dialog. */
export const finishButton = (): HTMLElement => screen.getByRole("button", { name: "Finish workout" });

/** Spec 17.1 AC32: Discard lives in the Workout menu. */
export async function discardWorkout(user: UserEvent): Promise<void> {
  const menu = screen.getByRole("button", { name: "Workout menu" });
  if (menu.getAttribute("aria-expanded") !== "true") await user.click(menu);
  await user.click(screen.getByRole("button", { name: "Discard workout" }));
}

/** Exercise names in display order (a collapsed row's heading holds its summary, so read the name before " · "). */
export function cardNames(): string[] {
  return screen.getAllByRole("article").map((article) => {
    const heading = article.querySelector("h2");
    const collapsed = heading?.querySelector("button");
    const text = (collapsed ?? heading)?.textContent ?? "";
    return collapsed ? text.split(" · ")[0]! : text;
  });
}

/**
 * A same-values tap within the 600 ms double-tap window is the same tap (Spec 06.2, 17.1): a real next set comes later.
 *
 * Minors 202, 237: the Log bar drops a tap within `DOUBLE_TAP_MS` of the last one by `Date.now()`. A test that fakes
 * Date (frozen, or `shouldAdvanceTime`, which lags real time under a parallel run: a probe saw 580 ms of fake time over
 * 654 ms real) would not see the window pass, so with fake timers the rest also moves the clock past it. Real-timer
 * callers just wait.
 */
export async function restBetweenSets(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 650));
  if (vi.isFakeTimers()) vi.setSystemTime(Date.now() + DOUBLE_TAP_MS);
}

/** Spec 17.1 AC23: Set type and the unit selects sit under "Set options" in the current-set panel. */
export async function openSetOptions(user: UserEvent, scope: HTMLElement): Promise<void> {
  const toggle = within(scope).getByRole("button", { name: "Set options" });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
}

/** Spec 18.0 AC34 / AC40: the header's Change Time button (live row 2, or the edit header). */
export const changeTimeButton = (): HTMLElement => screen.getByRole("button", { name: "Change Time" });
