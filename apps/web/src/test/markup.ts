/**
 * The markup of `element` with everything that is not structure removed, for the "renders exactly as
 * before" comparisons (Spec 10.3 AC14, AC20, AC24, AC31, AC32): React's `useId` makes `id` and the
 * attributes that reference ids unstable between renders, and the Note action (`data-note-action`,
 * AC32) is the one allowed difference on an active card. `data-variant` is `Button`'s test hook
 * (minor 249), added after these baselines were recorded; it is not structure.
 */
export function markupOf(element: Element): string {
  const clone = element.cloneNode(true) as Element;
  for (const node of clone.querySelectorAll("[data-note-action]")) node.remove();
  for (const node of [clone, ...clone.querySelectorAll("*")]) {
    for (const attribute of ["id", "for", "aria-labelledby", "aria-describedby", "aria-controls", "data-variant"]) node.removeAttribute(attribute);
  }
  return clone.outerHTML;
}
