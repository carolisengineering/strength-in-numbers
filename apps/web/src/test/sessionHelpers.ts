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

/** Spec 17.5 AC18: Delete set asks first, in place. `dialog` is the sheet, or queries already bound to it. */
export async function deleteSetIn(user: UserEvent, dialog: HTMLElement | ReturnType<typeof within>): Promise<void> {
  const scope = dialog instanceof HTMLElement ? within(dialog) : dialog;
  await user.click(scope.getByRole("button", { name: "Delete set" }));
  await user.click(scope.getByRole("button", { name: "Delete set" }));
}

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
 * 654 ms real) would not see the window pass, so with fake timers the rest advances the fake clock itself, by more than
 * the window. That never waits on `setTimeout`, which may be faked too. Real-timer callers just wait.
 */
export async function restBetweenSets(): Promise<void> {
  if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(DOUBLE_TAP_MS + 50);
  else await new Promise((resolve) => setTimeout(resolve, 650));
}

/** Spec 17.1 AC23: set type and the units sit under "More" in the current-set panel ("Set options" until Spec 17.7). */
export async function openSetOptions(user: UserEvent, scope: HTMLElement): Promise<void> {
  const toggle = within(scope).getByRole("button", { name: /^More set options for / });
  if (toggle.getAttribute("aria-expanded") !== "true") await user.click(toggle);
}

/** Spec 18.0 AC34 / AC40: the header's Change Time button (live row 2, or the edit header). */
export const changeTimeButton = (): HTMLElement => screen.getByRole("button", { name: "Change Time" });

/**
 * Spec 17.7 AC19, AC20: the superset toggles and Add / Edit note live in a card's Options; open it if it is closed.
 * With no `name`, the live screen's current card (the only one with Options); the edit screen passes the card's name.
 */
export async function showOptions(user: UserEvent, name?: string | RegExp): Promise<void> {
  const options = name === undefined ? screen.getByRole("button", { name: /^Options for / }) : optionsButton(name);
  if (options.getAttribute("aria-expanded") !== "true") await user.click(options);
}

/** Spec 17.7 AC19: the superset toggles are in the current card's Options. */
export const showLinks = (user: UserEvent): Promise<void> => showOptions(user);

/**
 * Spec 17.7 AC19, AC23: the live screen's toggle for the joint between `above` and `below`, from whichever side is
 * current: "Superset with next: {below}" in the upper card's Options, "Superset with previous: {above}" in the lower's.
 */
export const linkToggleQuery = (above: string, below: string): RegExp =>
  new RegExp(`^Superset with (next: ${escape(below)}|previous: ${escape(above)})$`);
export const linkToggle = (above: string, below: string): HTMLElement => screen.getByRole("button", { name: linkToggleQuery(above, below) });
