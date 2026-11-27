/**
 * Minor 637: the refused finish ops whose banner has been scrolled into view, for the page load, so a return to the
 * workout keeps the reveal of the current panel. Minor 699: tests reset it through `cleanupApp`, since a page load
 * there is the whole test file.
 */
const scrolledRefusals = new Set<string>();

/** True the first time it is asked about `opId` on this page load (and records it); false after. */
export function firstScrollOf(opId: string): boolean {
  if (scrolledRefusals.has(opId)) return false;
  scrolledRefusals.add(opId);
  return true;
}

export function resetScrolledRefusalsForTests(): void {
  scrolledRefusals.clear();
}
