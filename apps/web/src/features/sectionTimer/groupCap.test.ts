import { describe, expect, it } from "vitest";
import { capLineShown } from "./groupCap";

const eight = <T,>(v: T): T[] => Array.from({ length: 8 }, () => v);

describe("10.7 AC23 — the cap line rule", () => {
  it.each<[string, (number | null)[], boolean]>([
    ["8 grouped then one loose", [...eight(1), null], true],
    ["exactly 8, all grouped", eight(1), false],
    ["the 9th starts another group", [...eight(1), 2], false],
    ["nine loose", [...eight(null), null], false],
    ["8 grouped then two loose", [...eight(1), null, null], true],
    ["the first 8 are split between two groups", [1, 1, 1, 1, 2, 2, 2, 2, null], false],
    ["empty", [], false],
  ])("%s", (_name, groups, expected) => {
    expect(capLineShown(groups)).toBe(expected);
  });
});
