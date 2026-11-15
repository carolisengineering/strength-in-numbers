import type { SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { sectioned } from "../../test/sectionedDraft";
import { makeRoutine, makeRoutineItem, makeRoutineSection, sectionId } from "../../test/workoutFixtures";
import { actions, draftFromRoutine, groupCapShown, reduce, type Draft } from "./routineDraft";

const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const timedM = (spec: string): Draft => {
  const d = sectioned("", ["M", spec]);
  return { ...d, sections: d.sections.map((s) => ({ ...s, timer: SET_TIMER })) };
};
const run = (d: Draft, ...acts: Parameters<typeof reduce>[1][]) => acts.reduce(reduce, d);
const capLine = (d: Draft) => groupCapShown(d, d.sections[0]!);

describe("minor 314 — the cap line shows only when a fill or join stopped at 8", () => {
  it("a hand-linked 8 with a 9th loose shows no cap line", () => {
    expect(capLine(timedM("a1 b1 c1 d1 e1 f1 g1 h1 i"))).toBe(false);
  });

  it("linking 8 by hand in a timed section shows no cap line", () => {
    const d = run(timedM("a1 b1 c1 d1 e1 f1 g1 h i"), actions.toggleLink(6));
    expect(d.items.map((i) => i.supersetGroup)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(capLine(d)).toBe(false);
  });

  it("a fill of a 10-exercise section shows it; unlinking one there clears it", () => {
    const filled = run(sectioned("", ["M", "a b c d e f g h i j"]), actions.setSectionTimer("M", SET_TIMER));
    expect(capLine(filled)).toBe(true);
    expect(capLine(run(filled, actions.toggleLink(0)))).toBe(false);
  });

  it("a join that capped shows it; a later move in the section clears it", () => {
    const joined = run(timedM("a1 b1 c1 d1 e1 f1 g1 h1"), actions.add(exerciseId(20)));
    expect(capLine(joined)).toBe(true);
    expect(capLine(run(joined, actions.moveUp(joined.items[8]!.key)))).toBe(false);
  });

  it("Review Focus 3: a loaded routine starts with no cap line until a fill or join caps again", () => {
    const load = (count: number) =>
      draftFromRoutine(
        makeRoutine({
          sections: [makeRoutineSection({ id: sectionId(1), timer: SET_TIMER })],
          items: Array.from({ length: count }, (_, p) => makeRoutineItem({ position: p, sectionId: sectionId(1), supersetGroup: p < 8 ? 1 : null })),
        }),
      );
    const saved = load(9);
    expect(saved.items.map((i) => i.supersetGroup)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(capLine(saved)).toBe(false);
    const eight = load(8);
    expect(capLine(eight)).toBe(false);
    expect(capLine(run(eight, actions.add(exerciseId(30))))).toBe(true);
  });
});
