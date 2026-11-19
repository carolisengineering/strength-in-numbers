/**
 * Spec 07.6 D7, AC15–AC16: the History row's record badge over `recordCount`, the number of lifts with a beaten record
 * (Phase A). The visible text is the short trophy label; the name says it in the summary heading's words.
 */
export function historyBadgeText(n: number): { visible: string; name: string } {
  const lifts = `${n} ${n === 1 ? "lift" : "lifts"}`;
  return { visible: `PR on ${lifts}`, name: `Records on ${lifts}` };
}
