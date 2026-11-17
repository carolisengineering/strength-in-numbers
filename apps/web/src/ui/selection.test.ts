import { describe, expect, it } from "vitest";

import { selectedId } from "./selection";

describe("17.12 AC16 — selection is derived", () => {
  const ids = ["a", "b"] as const;

  it.each([
    { routeId: "b", ids, wide: true, expected: "b", why: "the route's id wins" },
    { routeId: "z", ids, wide: true, expected: "z", why: "even when it isn't in the loaded list (an old link, an unloaded page)" },
    { routeId: null, ids, wide: true, expected: "a", why: "wide with no route id: the first (newest)" },
    { routeId: null, ids: [] as const, wide: true, expected: null, why: "nothing to choose" },
    { routeId: null, ids, wide: false, expected: null, why: "the phone chooses nothing" },
    { routeId: "b", ids, wide: false, expected: "b", why: "the phone still marks the route's id" },
  ])("$why", ({ routeId, ids: list, wide, expected }) => {
    expect(selectedId(routeId, list, wide)).toBe(expected);
  });
});
