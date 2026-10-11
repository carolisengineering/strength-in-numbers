import { describe, expect, it } from "vitest";
import {
  canLinkRule,
  isLinked,
  LINK_CAP_MESSAGE,
  linkRule,
  moveRule,
  NO_LINK_TARGET_MESSAGE,
  runOrdinals,
  runPosition,
  unlinkRule,
  type SessionSlot,
} from "../src/supersets.js";
import { s } from "./helpers/supersets.js";

const groupsOf = (slots: readonly SessionSlot[]) => slots.map((x) => x.group);
const idsOf = (slots: readonly SessionSlot[]) => slots.map((x) => x.id).join("");
const linked = (slots: SessionSlot[], i: number) => {
  const r = linkRule(slots, i);
  if (!r.ok) throw new Error(r.reason);
  return groupsOf(r.slots);
};

describe("10.1 AC1 — linkRule", () => {
  it("two ungrouped slots form a run of two", () => {
    expect(linked(s(null, null, null), 0)).toEqual([1, 1, null]);
    expect(linked(s(null, null, null), 1)).toEqual([null, 1, 1]);
  });
  it("an ungrouped neighbour joins the run, above or below", () => {
    expect(linked(s(null, 5, 5), 0)).toEqual([1, 1, 1]);
    expect(linked(s(5, 5, null), 1)).toEqual([1, 1, 1]);
    expect(linked(s(null, null, 3, 3), 1)).toEqual([null, 1, 1, 1]);
  });
  it("two runs become one", () => {
    expect(linked(s(1, 1, 2, 2), 1)).toEqual([1, 1, 1, 1]);
  });
  it("an already-linked boundary is unchanged", () => {
    expect(linked(s(4, 4), 0)).toEqual([1, 1]);
  });
  it("7 + 1 reaches the cap of 8; 4 + 5 is refused with the message and changes nothing", () => {
    expect(linked(s(1, 1, 1, 1, 1, 1, 1, null), 6)).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
    const input = s(1, 1, 1, 1, 2, 2, 2, 2, 2);
    expect(linkRule(input, 3)).toEqual({ ok: false, reason: LINK_CAP_MESSAGE });
    expect(LINK_CAP_MESSAGE).toBe("A superset can have up to 8 exercises");
  });
  it("the last slot or an out-of-range index has nothing to link with", () => {
    expect(linkRule(s(null, null, null), 2)).toEqual({ ok: false, reason: NO_LINK_TARGET_MESSAGE });
    expect(linkRule(s(null, null), -1)).toEqual({ ok: false, reason: NO_LINK_TARGET_MESSAGE });
    expect(NO_LINK_TARGET_MESSAGE).toBe("No exercise to link with");
  });
  it("canLinkRule agrees with linkRule at every boundary", () => {
    const lists = [s(null, null, 1, 1), s(1, 1, 1, 1, 2, 2, 2, 2, 2), s(1, 1, 1, 1, 1, 1, 1, null, null), s(3, null, 3, 3, 40)];
    for (const list of lists) {
      for (let i = -1; i <= list.length; i++) expect(canLinkRule(list, i).ok, `${groupsOf(list)} @${i}`).toBe(linkRule(list, i).ok);
    }
  });
});

describe("10.1 AC2 — unlinkRule and isLinked", () => {
  it("splits a run at the boundary; a side of one becomes ungrouped", () => {
    expect(groupsOf(unlinkRule(s(1, 1, 1, 1), 0))).toEqual([null, 1, 1, 1]);
    expect(groupsOf(unlinkRule(s(1, 1, 1, 1), 1))).toEqual([1, 1, 2, 2]);
    expect(groupsOf(unlinkRule(s(1, 1, 1, 1), 2))).toEqual([1, 1, 1, null]);
    expect(groupsOf(unlinkRule(s(1, 1), 0))).toEqual([null, null]);
  });
  it("is a no-op on an unlinked boundary", () => {
    expect(groupsOf(unlinkRule(s(1, 1, null), 1))).toEqual([1, 1, null]);
    expect(groupsOf(unlinkRule(s(null, null), 0))).toEqual([null, null]);
  });
  it("isLinked is true only when both sides share a non-null group", () => {
    const list = s(1, 1, null, 2, 2);
    expect([0, 1, 2, 3].map((i) => isLinked(list, i))).toEqual([true, false, false, true]);
    expect([0, 1].map((i) => isLinked(s(3, null, 3), i))).toEqual([false, false]);
    expect(isLinked(s(1, 1), 1)).toBe(false);
    expect(isLinked(s(1, 1), -1)).toBe(false);
  });
});

describe("10.1 AC3 — moveRule (block moves)", () => {
  const moved = (list: SessionSlot[], i: number, dir: -1 | 1) => {
    const out = moveRule(list, i, dir);
    return out === null ? null : { ids: idsOf(out), groups: groupsOf(out) };
  };
  it("within a run: a plain swap, group unchanged", () => {
    expect(moved(s(1, 1, 1), 1, -1)).toEqual({ ids: "bac", groups: [1, 1, 1] });
  });
  it("an edge member moving outward leaves the run, then moves as ungrouped", () => {
    expect(moved(s(1, 1, 1, null), 2, 1)).toEqual({ ids: "abdc", groups: [1, 1, null, null] });
    expect(moved(s(null, 1, 1, 1), 1, -1)).toEqual({ ids: "bacd", groups: [null, null, 1, 1] });
  });
  it("a run of two dissolves when a member leaves", () => {
    expect(moved(s(1, 1, null), 1, 1)).toEqual({ ids: "acb", groups: [null, null, null] });
  });
  it("an ungrouped slot jumps the whole run and never lands inside it", () => {
    expect(moved(s(null, 1, 1, 1), 0, 1)).toEqual({ ids: "bcda", groups: [1, 1, 1, null] });
    expect(moved(s(1, 1, null), 2, -1)).toEqual({ ids: "cab", groups: [null, 1, 1] });
  });
  it("two adjacent runs: an edge member leaves its run and jumps the neighbouring one", () => {
    expect(moved(s(1, 1, 2, 2), 1, 1)).toEqual({ ids: "acdb", groups: [null, 1, 1, null] });
    expect(moved(s(1, 1, 2, 2), 2, -1)).toEqual({ ids: "cabd", groups: [null, 1, 1, null] });
  });
  it("moving the first slot up or the last down is a no-op (null)", () => {
    expect(moveRule(s(null, null), 0, -1)).toBeNull();
    expect(moveRule(s(null, null), 1, 1)).toBeNull();
    expect(moveRule(s(null, null), 5, 1)).toBeNull();
  });
});

describe("10.1 AC4 — tolerant inputs", () => {
  it("a group of one is ungrouped; a split group is two runs; sparse numbers are fine", () => {
    expect(linked(s(5, null, null), 0)).toEqual([1, 1, null]);
    expect(linked(s(3, 3, null, 3, 3), 2)).toEqual([1, 1, 2, 2, 2]);
    expect(groupsOf(moveRule(s(3, null, 3, 3, 40), 0, 1)!)).toEqual([null, null, 1, 1, null]);
  });
  it("never throws and never mutates its input", () => {
    const frozen = Object.freeze(s(3, null, 3, 3, 40).map((x) => Object.freeze(x)));
    expect(() => {
      for (let i = -1; i <= frozen.length; i++) {
        linkRule(frozen, i);
        unlinkRule(frozen, i);
        canLinkRule(frozen, i);
        moveRule(frozen, i, 1);
        moveRule(frozen, i, -1);
      }
    }).not.toThrow();
    expect(groupsOf(frozen)).toEqual([3, null, 3, 3, 40]);
  });
});

describe("10.1 AC6 — runPosition and runOrdinals", () => {
  it("runPosition: first / middle / last inside a run, none otherwise", () => {
    const g = [7, 7, null, 3, 3, 3, 40];
    expect(g.map((_, i) => runPosition(g, i))).toEqual(["first", "last", "none", "first", "middle", "last", "none"]);
    expect(runPosition([1], 0)).toBe("none");
    expect(runPosition([1, 2], 0)).toBe("none");
    expect(runPosition([null], 0)).toBe("none");
  });
  it("runOrdinals numbers runs 1, 2 … on screen; everything else is null", () => {
    expect(runOrdinals([7, 7, null, 3, 3, 3, 40])).toEqual([1, 1, null, 2, 2, 2, null]);
    expect(runOrdinals([5, 5, 6, 6])).toEqual([1, 1, 2, 2]);
    expect(runOrdinals([3, 3, null, 3, 3])).toEqual([1, 1, null, 2, 2]);
    expect(runOrdinals([])).toEqual([]);
  });
});
