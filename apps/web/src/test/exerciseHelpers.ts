import { screen, waitFor } from "@testing-library/react";

import { EXERCISES_COPY } from "../features/exercises/messages";

/**
 * Minor 515: the exercise page's details table, found through its disclosure (the `dl` has no label of its own, since
 * the summary "Exercise details" already names it).
 */
export function detailsTable(): HTMLElement {
  const summary = screen.getByText(EXERCISES_COPY.detailsLabel, { selector: "summary" });
  const dl = summary.closest("details")?.querySelector("dl");
  if (!dl) throw new Error("No details table in the Exercise details disclosure");
  return dl;
}

export async function findDetailsTable(): Promise<HTMLElement> {
  let found: HTMLElement | null = null;
  await waitFor(() => {
    found = detailsTable();
  });
  return found!;
}
