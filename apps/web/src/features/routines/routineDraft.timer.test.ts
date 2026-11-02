import { RoutineWriteSchema, type SectionTimer } from "@sin/core";
import { describe, expect, it } from "vitest";
import { exerciseId } from "../../test/catalogFixtures";
import { sectioned } from "../../test/sectionedDraft";
import { makeRoutine, makeRoutineItem, makeRoutineSection, sectionId } from "../../test/workoutFixtures";
import { actions, draftFromRoutine, groupCapShown, reduce, type Draft } from "./routineDraft";
import { toRoutineInput } from "./validateDraft";

const SET_TIMER: SectionTimer = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP: SectionTimer = { format: "amrap", capSeconds: 720 };
const body = (d: Draft) => toRoutineInput(d, { modalityOf: () => null });
const groups = (d: Draft, key = "M") => d.items.filter((i) => i.sectionKey === key).map((i) => i.supersetGroup);
/** `sectioned` with section M timed. */
const timedM = (spec: string, timer: SectionTimer = SET_TIMER): Draft => {
  const d = sectioned("", ["M", spec]);
  return { ...d, sections: d.sections.map((s) => ({ ...s, timer })) };
};
const run = (d: Draft, ...acts: Parameters<typeof reduce>[1][]) => acts.reduce(reduce, d);

describe("10.7 AC8 — draft and body", () => {
  it.each<SectionTimer>([SET_TIMER, AMRAP, { format: "time_cap", capSeconds: 900 }, { format: "time_cap", capSeconds: null }])("load keeps %j", (timer) => {
    const d = draftFromRoutine(makeRoutine({ sections: [makeRoutineSection({ id: sectionId(1), timer })], items: [makeRoutineItem({ position: 0, sectionId: sectionId(1) })] }));
    expect(d.sections[0]!.timer).toEqual(timer);
    expect(d.dirty).toBe(false);
  });

  it("an untimed draft's body has no timer key anywhere", () => {
    const d = draftFromRoutine(makeRoutine({ sections: [makeRoutineSection({ id: sectionId(1), notes: "n" })], items: [makeRoutineItem({ position: 0, sectionId: sectionId(1) })] }));
    expect(JSON.stringify(body(d))).not.toContain("timer");
    expect(body(d).sections).toEqual([{ key: "s1", name: "Warm-up", notes: "n" }]);
  });

  it("a timer is the section's last key; dropping it omits the key", () => {
    const d = run(sectioned("", ["M", "a"]), actions.setSectionTimer("M", SET_TIMER));
    expect(Object.keys(body(d).sections![0]!)).toEqual(["key", "name", "timer"]);
    expect(body(d).sections![0]!.timer).toEqual(SET_TIMER);
    expect(body(run(d, actions.setSectionTimer("M", null))).sections![0]).toEqual({ key: "s1", name: "M" });
  });

  it("a new section has no timer", () => {
    expect(run(sectioned(""), actions.addSection("Main")).sections[0]!.timer).toBeNull();
  });

  it("a For Time cap is sent as { format: time_cap } with no capSeconds key (Review Focus 3)", () => {
    const d = run(sectioned("", ["M", "a"]), actions.setSectionTimer("M", { format: "time_cap", capSeconds: null }));
    expect(body(d).sections![0]!.timer).toStrictEqual({ format: "time_cap" });
  });
});

describe("10.7 AC13 — editor coupling (reducer)", () => {
  it.each<[string, SectionTimer]>([
    ["Set Timer", SET_TIMER],
    ["AMRAP", AMRAP],
  ])("None → %s on 3 loose items makes them one superset", (_l, timer) => {
    const d = run(sectioned("", ["M", "a b c"]), actions.setSectionTimer("M", timer));
    expect(groups(d)).toEqual([1, 1, 1]);
    expect(d.dirty).toBe(true);
  });

  it("a format change on a loose section fills it too", () => {
    const d = run(timedM("a b c"), actions.setSectionTimer("M", AMRAP));
    expect(groups(d)).toEqual([1, 1, 1]);
  });

  it("a section with one superset of 2 plus a loose 1, made timed, is unchanged", () => {
    expect(groups(run(sectioned("", ["M", "a1 b1 c"]), actions.setSectionTimer("M", SET_TIMER)))).toEqual([1, 1, null]);
  });

  it("two supersets of 2 (a Second Shift) keep both", () => {
    expect(groups(run(sectioned("", ["M", "a1 b1 c2 d2"]), actions.setSectionTimer("M", AMRAP)))).toEqual([1, 1, 2, 2]);
  });

  it("adding to a timed last section that is one superset of 3 joins it", () => {
    expect(groups(run(timedM("a1 b1 c1"), actions.add(exerciseId(20))))).toEqual([1, 1, 1, 1]);
  });

  it("adding to a timed section with a lone other item groups both", () => {
    expect(groups(run(timedM("a"), actions.add(exerciseId(20))))).toEqual([1, 1]);
  });

  it.each<[string, string, (number | null)[]]>([
    ["two supersets", "a1 b1 c2 d2", [1, 1, 2, 2, null]],
    ["3 loose items the lifter unlinked", "a b c", [null, null, null, null]],
  ])("adding to a timed section with %s stays loose", (_l, spec, expected) => {
    expect(groups(run(timedM(spec), actions.add(exerciseId(20))))).toEqual(expected);
  });

  it("moving an item into a timed section that is one superset joins it", () => {
    const d = sectioned("z1 y1", ["M", "a1 b1"]);
    const timed = { ...d, sections: d.sections.map((s) => ({ ...s, timer: SET_TIMER })) };
    const moved = run(timed, actions.moveItemToSection("z", "M"));
    expect(groups(moved)).toEqual([1, 1, 1]);
  });

  it.each<[string, (d: Draft) => Draft]>([
    ["a rename", (d) => run(d, actions.renameSection("M", "Main"))],
    ["a note edit", (d) => run(d, actions.setSectionNotes("M", "Rx"))],
    ["a same-format number change", (d) => run(d, actions.setSectionTimer("M", { format: "set_timer", roundSeconds: 300, rounds: 4 }))],
    ["choosing None", (d) => run(d, actions.setSectionTimer("M", null))],
  ])("%s changes no supersetGroup", (_l, act) => {
    expect(groups(act(timedM("a b c")))).toEqual([null, null, null]);
  });

  it("loading a timed, ungrouped section neither regroups it nor marks the draft dirty (Review Focus 2)", () => {
    const d = draftFromRoutine(
      makeRoutine({
        sections: [makeRoutineSection({ id: sectionId(1), timer: AMRAP })],
        items: [0, 1, 2].map((p) => makeRoutineItem({ position: p, sectionId: sectionId(1) })),
      }),
    );
    expect(d.items.map((i) => i.supersetGroup)).toEqual([null, null, null]);
    expect(d.dirty).toBe(false);
  });

  it("an unknown section or the same timer changes nothing", () => {
    const d = timedM("a b");
    expect(reduce(d, actions.setSectionTimer("nope", AMRAP))).toBe(d);
    expect(reduce(d, actions.setSectionTimer("M", { ...SET_TIMER }))).toBe(d);
  });

  it("9 loose items made timed: the first 8 grouped, the 9th loose, and the cap line shows", () => {
    const d = run(sectioned("", ["M", "a b c d e f g h i"]), actions.setSectionTimer("M", SET_TIMER));
    expect(groups(d)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(groupCapShown(d.items, d.sections[0]!)).toBe(true);
  });

  it("a 9th added to a timed superset of 8 stays loose; the cap line shows; the body is valid (Review Focus 4)", () => {
    const d = run(timedM("a1 b1 c1 d1 e1 f1 g1 h1"), actions.add(exerciseId(20)));
    expect(groups(d)).toEqual([1, 1, 1, 1, 1, 1, 1, 1, null]);
    expect(groupCapShown(d.items, d.sections[0]!)).toBe(true);
    expect(RoutineWriteSchema.safeParse(body(d)).success).toBe(true);
  });

  it("the cap line doesn't show for an untimed section or 8 items", () => {
    const untimed = sectioned("", ["M", "a1 b1 c1 d1 e1 f1 g1 h1 i"]);
    expect(groupCapShown(untimed.items, untimed.sections[0]!)).toBe(false);
    const eight = timedM("a1 b1 c1 d1 e1 f1 g1 h1");
    expect(groupCapShown(eight.items, eight.sections[0]!)).toBe(false);
  });

  it("an unlink after a fill stays unlinked across rename, note and same-format edits", () => {
    const filled = run(sectioned("", ["M", "a b c"]), actions.setSectionTimer("M", SET_TIMER));
    const unlinked = run(filled, actions.toggleLink(1));
    const before = groups(unlinked);
    const after = run(
      unlinked,
      actions.renameSection("M", "Main"),
      actions.setSectionNotes("M", "Rx"),
      actions.setSectionTimer("M", { format: "set_timer", roundSeconds: 240, rounds: 5 }),
    );
    expect(groups(after)).toEqual(before);
  });
});

describe("10.7 AC13 — the unlink notice tells the truth", () => {
  it("a grouped exercise moved into a timed section that joins it shows no unlink notice", () => {
    const d = sectioned("z1 y1", ["M", "a1 b1"]);
    const timed = { ...d, sections: d.sections.map((s) => ({ ...s, timer: SET_TIMER })) };
    const moved = run(timed, actions.moveItemToSection("z", "M"));
    expect(groups(moved)).toEqual([1, 1, 1]);
    expect(moved.unlinkNotice).toBe(false);
  });

  it("a grouped exercise moved into a timed section it can't join still shows it", () => {
    const d = sectioned("z1 y1", ["M", "a1 b1 c2 d2"]);
    const timed = { ...d, sections: d.sections.map((s) => ({ ...s, timer: SET_TIMER })) };
    const moved = run(timed, actions.moveItemToSection("z", "M"));
    expect(moved.items.find((i) => i.key === "z")!.supersetGroup).toBeNull();
    expect(moved.unlinkNotice).toBe(true);
  });
});
