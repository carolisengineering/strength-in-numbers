import type { RouteKey } from "./registry.js";
import type { CrossUserCase } from "./cases.js";

/**
 * Spec 21.0 §6.1, AC3, AC6 — the coverage gate. Returns every failure at once
 * (an empty list passes), so one run names everything a new route still needs.
 *
 * `slotsOf` gives a route's *required* id slots (`requiredSlots`: the walker's
 * slots minus `NOT_A_SIN_ID`).
 *
 * Minor 376: `covers` means what the runner does with it. A `foreign-id` case
 * puts B's id in exactly one slot, so it covers exactly one; the other kinds
 * send no foreign id, so they cover none.
 */
export function checkCoverage(
  registered: readonly RouteKey[],
  cases: readonly CrossUserCase[],
  exemptions: Readonly<Record<RouteKey, string>>,
  slotsOf: (key: RouteKey) => readonly string[],
): string[] {
  const failures: string[] = [];
  const registeredSet = new Set(registered);
  const covered = new Set(cases.map((c) => c.route));
  const exempt = new Set(Object.keys(exemptions) as RouteKey[]);

  for (const key of registered) {
    if (!covered.has(key) && !exempt.has(key)) failures.push(`${key} has no cross-user case or exemption`);
    if (covered.has(key) && exempt.has(key)) failures.push(`${key} is both covered by a case and exempt`);
  }
  for (const key of covered) {
    if (!registeredSet.has(key)) failures.push(`stale entry: case for ${key} names a route the app does not register`);
  }
  for (const key of exempt) {
    if (!registeredSet.has(key)) failures.push(`stale entry: exemption for ${key} names a route the app does not register`);
  }

  // An exemption says "this route reads no other row"; a route that takes an id can't claim that.
  for (const key of registered) {
    if (!exempt.has(key)) continue;
    for (const slot of slotsOf(key)) failures.push(`${key} is exempt but takes ${slot}; an id slot needs a case`);
  }

  for (const key of registered) {
    if (!covered.has(key)) continue;
    const slots = new Set(slotsOf(key));
    const routeCases = cases.filter((c) => c.route === key);
    for (const c of routeCases) {
      if (c.kind === "foreign-id" && c.covers.length !== 1) {
        failures.push(`${key} case "${c.name}" is a foreign-id case covering ${c.covers.length} slots; it must cover exactly one`);
      }
      if (c.kind !== "foreign-id" && c.covers.length > 0) {
        failures.push(`${key} case "${c.name}" is a ${c.kind} case but claims ${c.covers.join(", ")}; only a foreign-id case covers a slot`);
      }
    }
    // Only a foreign-id case aiming at one slot counts toward that slot.
    const claimed = new Set(routeCases.filter((c) => c.kind === "foreign-id" && c.covers.length === 1).flatMap((c) => c.covers));
    for (const slot of slots) {
      if (!claimed.has(slot)) failures.push(`${key} slot ${slot} is not covered`);
    }
    for (const c of routeCases) {
      for (const slot of c.covers) {
        if (!slots.has(slot)) failures.push(`${key} case "${c.name}" covers ${slot}, which the route does not have`);
      }
    }
  }
  return failures;
}
