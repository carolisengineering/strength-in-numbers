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
import { planSessionChange, type SessionOp } from "../src/supersets.js";
import { applyPatches, contiguous } from "./helpers/supersets.js";

const toggle = (index: number): SessionOp => ({ type: "toggleLink", index });
const move = (id: string, direction: "up" | "down"): SessionOp => ({ type: "move", id, direction });
const okPlan = (current: readonly SessionSlot[], op: SessionOp) => {
  const plan = planSessionChange(current, op);
  if (!plan.ok) throw new Error(plan.reason);
  return plan;
};

describe("10.1 AC7 — planSessionChange contract", () => {
  it("a rule no-op (last-slot toggle, edge move, unknown id) is ok with no patches and next = current", () => {
    const current = s(null, null);
    expect(planSessionChange(current, toggle(1))).toEqual({ ok: true, patches: [], next: current });
    expect(planSessionChange(current, move("a", "up"))).toEqual({ ok: true, patches: [], next: current });
    expect(planSessionChange(current, move("zz", "down"))).toEqual({ ok: true, patches: [], next: current });
  });
  it("a cap refusal is reported, not planned", () => {
    expect(planSessionChange(s(1, 1, 1, 1, 2, 2, 2, 2, 2), toggle(3))).toEqual({ ok: false, reason: "cap", message: LINK_CAP_MESSAGE });
  });
  it("next is what the patches produce, and the input is never mutated", () => {
    const current = Object.freeze(s(1, 1, null, 2, 2).map((x) => Object.freeze(x)));
    for (const op of [toggle(1), toggle(2), move("c", "up"), move("b", "down")]) {
      const plan = okPlan(current, op);
      expect(applyPatches(current, plan.patches)).toEqual(plan.next);
    }
    expect(groupsOf(current)).toEqual([1, 1, null, 2, 2]);
  });
});

describe("10.1 AC8 — numbering", () => {
  it("a new run takes the smallest number not carried by any slot (gaps are reused)", () => {
    const plan = okPlan(s(1, 1, null, 3, 3, null, null), toggle(5));
    expect(plan.patches).toEqual([{ id: "f", supersetGroup: 2 }, { id: "g", supersetGroup: 2 }]);
    expect(groupsOf(plan.next)).toEqual([1, 1, null, 3, 3, 2, 2]);
    expect(okPlan(s(null, null), toggle(0)).patches).toEqual([{ id: "a", supersetGroup: 1 }, { id: "b", supersetGroup: 1 }]);
  });
  it("untouched groups keep their sparse / high numbers", () => {
    const plan = okPlan(s(40, 40, null, null, 77, 77), toggle(2));
    expect(plan.patches).toEqual([{ id: "c", supersetGroup: 1 }, { id: "d", supersetGroup: 1 }]);
    expect(groupsOf(plan.next)).toEqual([40, 40, 1, 1, 77, 77]);
  });
  it("an untouched stray (a group of one) keeps its stored number: no patch", () => {
    const plan = okPlan(s(40, null, null), toggle(1));
    expect(plan.patches).toEqual([{ id: "b", supersetGroup: 1 }, { id: "c", supersetGroup: 1 }]);
    expect(groupsOf(plan.next)).toEqual([40, 1, 1]);
  });
  it("a stray carrying a touched run's number forces a fresh number", () => {
    const plan = okPlan(s(2, 2, null, 2), toggle(1));
    expect(plan.patches).toEqual([
      { id: "a", supersetGroup: 1 },
      { id: "b", supersetGroup: 1 },
      { id: "c", supersetGroup: 1 },
    ]);
    expect(groupsOf(plan.next)).toEqual([1, 1, 1, 2]);
  });
  it("99 is the ceiling; with every number carried the plan is no-free-group", () => {
    const strays98 = Array.from({ length: 98 }, (_, i) => ({ id: `x${i}`, group: i + 1 }));
    expect(okPlan(strays98, toggle(0)).patches).toEqual([{ id: "x0", supersetGroup: 99 }, { id: "x1", supersetGroup: 99 }]);
    const strays99 = Array.from({ length: 99 }, (_, i) => ({ id: `x${i}`, group: i + 1 }));
    expect(planSessionChange(strays99, toggle(0))).toEqual({ ok: false, reason: "no-free-group" });
  });
});

describe("10.1 AC9 — minimality and order", () => {
  it("merging two 4-runs renumbers the lower (tie: the upper keeps), nearest member first", () => {
    const plan = okPlan(s(1, 1, 1, 1, 2, 2, 2, 2), toggle(3));
    expect(plan.patches).toEqual(["e", "f", "g", "h"].map((id) => ({ id, supersetGroup: 1 })));
  });
  it("merging into a larger run renumbers the smaller side, nearest member first", () => {
    const plan = okPlan(s(5, 5, 7, 7, 7), toggle(1));
    expect(plan.patches).toEqual([{ id: "b", supersetGroup: 7 }, { id: "a", supersetGroup: 7 }]);
  });
  it("unlinking 4|4 gives the lower side a fresh number, far end first", () => {
    const plan = okPlan(s(1, 1, 1, 1, 1, 1, 1, 1), toggle(3));
    expect(plan.patches).toEqual(["h", "g", "f", "e"].map((id) => ({ id, supersetGroup: 2 })));
  });
  it("joining an ungrouped slot to a run is one patch", () => {
    expect(okPlan(s(null, 4, 4), toggle(0)).patches).toEqual([{ id: "a", supersetGroup: 4 }]);
  });
  it("unlink leaving a side of one: one patch; both sides of one: two", () => {
    const one = okPlan(s(3, 3, 3), toggle(0));
    expect(one.patches).toEqual([{ id: "a", supersetGroup: null }]);
    expect(groupsOf(one.next)).toEqual([null, 3, 3]);
    expect(okPlan(s(3, 3), toggle(0)).patches).toEqual([{ id: "a", supersetGroup: null }, { id: "b", supersetGroup: null }]);
  });
  it("moves: group patches first, the one position patch last", () => {
    expect(okPlan(s(6, 6, null), move("b", "down")).patches).toEqual([
      { id: "a", supersetGroup: null },
      { id: "b", supersetGroup: null },
      { id: "b", position: 2 },
    ]);
    expect(okPlan(s(2, 2, 2, null), move("c", "down")).patches).toEqual([{ id: "c", supersetGroup: null }, { id: "c", position: 3 }]);
  });
  it("an ungrouped slot jumping a run, a swap inside a run, and a plain move are one position patch each", () => {
    const jump = okPlan(s(null, 2, 2, 2), move("a", "down"));
    expect(jump.patches).toEqual([{ id: "a", position: 3 }]);
    expect(idsOf(jump.next)).toBe("bcda");
    expect(okPlan(s(2, 2), move("a", "down")).patches).toEqual([{ id: "a", position: 1 }]);
    expect(okPlan(s(null, null, null), move("b", "up")).patches).toEqual([{ id: "b", position: 0 }]);
  });
  it("every prefix of the patch list leaves each group contiguous", () => {
    const cases: [SessionSlot[], SessionOp][] = [
      [s(1, 1, 1, 1, 2, 2, 2, 2), toggle(3)],
      [s(1, 1, 1, 1, 1, 1, 1, 1), toggle(3)],
      [s(5, 5, 7, 7, 7), toggle(1)],
      [s(1, 1, 1, 1, 1), toggle(1)],
      [s(6, 6, null), move("b", "down")],
    ];
    for (const [current, op] of cases) {
      const { patches } = okPlan(current, op);
      for (let k = 0; k <= patches.length; k++) {
        expect(contiguous(groupsOf(applyPatches(current, patches.slice(0, k)))), `${groupsOf(current)} prefix ${k}`).toBe(true);
      }
    }
  });
});
