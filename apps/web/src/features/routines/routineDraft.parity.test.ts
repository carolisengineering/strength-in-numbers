import { canLinkRule, isLinked as isLinkedRule, LINK_CAP_MESSAGE as CORE_CAP, runPosition as coreRunPosition } from "@sin/core";
import { describe, expect, it } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, makeRoutineItem } from "../../test/workoutFixtures";
import { actions, canLink, draftFromRoutine, isLinked, LINK_CAP_MESSAGE, reduce, runPosition } from "./routineDraft";

const draftWith = (groups: (number | null)[]) =>
  draftFromRoutine(
    makeRoutine({ items: groups.map((supersetGroup, position) => makeRoutineItem({ position, supersetGroup, exerciseId: exerciseId(position + 1) })) }),
  );

describe("10.1 AC5 — the editor delegates to the core rules", () => {
  it("re-exports the core runPosition and LINK_CAP_MESSAGE", () => {
    expect(runPosition).toBe(coreRunPosition);
    expect(LINK_CAP_MESSAGE).toBe(CORE_CAP);
  });
  it("isLinked and canLink agree with the core rules at every boundary", () => {
    for (const groups of [[1, 1, null, 2, 2], [1, 1, 1, 1, 2, 2, 2, 2, 2], [null, null, null]]) {
      const draft = draftWith(groups);
      const slots = draft.items.map((i) => ({ id: i.key, group: i.supersetGroup }));
      for (let i = -1; i <= groups.length; i++) {
        expect(isLinked(draft.items, i)).toBe(isLinkedRule(slots, i));
        expect(canLink(draft, i)).toEqual(canLinkRule(slots, i));
      }
    }
  });
  it("toggleLink and moves still settle to dense 1, 2, 3 …", () => {
    const draft = draftWith([null, null, 4, 4]);
    const linked = reduce(draft, actions.toggleLink(0));
    expect(linked.items.map((i) => i.supersetGroup)).toEqual([1, 1, 2, 2]);
    const moved = reduce(linked, actions.moveDown(linked.items[1]!.key));
    expect(moved.items.map((i) => i.supersetGroup)).toEqual([null, 1, 1, null]);
  });
});
