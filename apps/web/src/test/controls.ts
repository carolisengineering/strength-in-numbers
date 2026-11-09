import { screen, within } from "@testing-library/react";
import type { UserEvent } from "@testing-library/user-event";

/**
 * Spec 17.7: tests reach a `Segmented` (a fieldset of native radios named by its legend) through these, so a test
 * reads "choose kg in Weight unit" rather than the strip's markup. A scope is an element or a `within(…)` result.
 */
type Scope = HTMLElement | Pick<typeof screen, "getByRole" | "queryByRole">;

const queries = (scope?: Scope) => (scope === undefined ? screen : scope instanceof HTMLElement ? within(scope) : scope);

export const segmented = (legend: string, scope?: Scope): HTMLElement => queries(scope).getByRole("group", { name: legend });

/** The group, or `null` when it isn't on screen. */
export const querySegmented = (legend: string, scope?: Scope): HTMLElement | null => queries(scope).queryByRole("group", { name: legend });

const radios = (legend: string, scope?: Scope) => within(segmented(legend, scope)).getAllByRole<HTMLInputElement>("radio");

export async function chooseSegment(user: UserEvent, legend: string, option: string, scope?: Scope): Promise<void> {
  await user.click(within(segmented(legend, scope)).getByRole("radio", { name: option }));
}

/** Choose by the option's value ("failure"), where a test spoke the select's value before. */
export async function chooseSegmentValue(user: UserEvent, legend: string, value: string, scope?: Scope): Promise<void> {
  const radio = radios(legend, scope).find((r) => r.value === value);
  if (radio === undefined) throw new Error(`${legend} has no option with the value ${value}`);
  await user.click(radio);
}

/** The checked option's label, or `null` when nothing is checked. */
export const segmentValue = (legend: string, scope?: Scope): string | null =>
  radios(legend, scope).find((radio) => radio.checked)?.closest("label")?.textContent ?? null;

/** The checked option's value ("warmup"), as a select's `toHaveValue` read it; `null` when nothing is checked. */
export const segmentChoice = (legend: string, scope?: Scope): string | null => radios(legend, scope).find((radio) => radio.checked)?.value ?? null;

/** The option labels in order. */
export const segmentOptions = (legend: string, scope?: Scope): (string | null)[] => radios(legend, scope).map((radio) => radio.closest("label")?.textContent ?? null);

/** The option values in order. */
export const segmentValues = (legend: string, scope?: Scope): string[] => radios(legend, scope).map((radio) => radio.value);
