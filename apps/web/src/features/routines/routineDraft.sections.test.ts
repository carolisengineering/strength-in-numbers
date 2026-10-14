import { describe, expect, it } from "vitest";
import { ROUTINE_ITEMS_MAX, ROUTINE_SECTIONS_MAX, sectionOrderViolations, sectionSpanViolations } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, makeRoutineItem, makeRoutineSection, sectionId } from "../../test/workoutFixtures";
import { sectioned, sectionNames, shape } from "../../test/sectionedDraft";
import { actions, canLink, draftFromRoutine, initialDraft, isLinked, LINK_CAP_MESSAGE, reduce, SECTION_LINK_REFUSAL, type Draft } from "./routineDraft";

describe("10.3 AC1 — draft model and load", () => {
  it("a routine without sections loads exactly as before: no sections, every sectionKey null, not dirty", () => {
    const d = draftFromRoutine(makeRoutine({ items: [makeRoutineItem({ position: 0 }), makeRoutineItem({ position: 1 })] }));
    expect(d.sections).toEqual([]);
    expect(d.items.map((i) => i.sectionKey)).toEqual([null, null]);
    expect(d.dirty).toBe(false);
    expect(d.adjusted).toBe(false);
  });

  it("sections sort by position; items map their sectionId to the section's key; item order is kept; not dirty", () => {
    const routine = makeRoutine({
      sections: [
        makeRoutineSection({ id: sectionId(2), position: 1, name: "Main", notes: null }),
        makeRoutineSection({ id: sectionId(1), position: 0, name: "Warm-up", notes: "5 min rower" }),
      ],
      items: [
        makeRoutineItem({ position: 0 }),
        makeRoutineItem({ position: 1, sectionId: sectionId(1) }),
        makeRoutineItem({ position: 2, sectionId: sectionId(2) }),
      ],
    });
    const d = draftFromRoutine(routine);
    expect(d.sections.map((s) => [s.name, s.notes])).toEqual([["Warm-up", "5 min rower"], ["Main", ""]]);
    expect(d.items.map((i) => i.sectionKey)).toEqual([null, d.sections[0]!.key, d.sections[1]!.key]);
    expect(d.dirty).toBe(false);
    expect(d.adjusted).toBe(false);
    expect(new Set([...d.sections.map((s) => s.key), ...d.items.map((i) => i.key)]).size).toBe(5); // keys are unique
  });

  it("an empty section loads (heading and note only)", () => {
    const d = draftFromRoutine(makeRoutine({ sections: [makeRoutineSection({ position: 0 })], items: [makeRoutineItem({ position: 0 })] }));
    expect(d.sections).toHaveLength(1);
    expect(d.items[0]!.sectionKey).toBeNull();
    expect(d.dirty).toBe(false);
  });

  it("a document that violates the invariants (another client's data) opens repaired and flagged adjusted + dirty", () => {
    // A sectioned item before a loose one, and a superset spanning the section boundary.
    const routine = makeRoutine({
      sections: [makeRoutineSection({ id: sectionId(1), position: 0, name: "Main" })],
      items: [
        makeRoutineItem({ position: 0, sectionId: sectionId(1), supersetGroup: 1 }),
        makeRoutineItem({ position: 1, supersetGroup: 1 }),
      ],
    });
    const d = draftFromRoutine(routine);
    expect(d.items.map((i) => i.sectionKey)).toEqual([null, d.sections[0]!.key]); // loose first
    expect(d.items.map((i) => i.supersetGroup)).toEqual([null, null]); // the run was split at the boundary; runs of one dissolve
    expect(d.adjusted).toBe(true);
    expect(d.dirty).toBe(true);
  });
});

describe("10.3 AC2 — section text actions", () => {
  const withNames = (...names: string[]) => names.reduce((d, n) => reduce(d, actions.addSection(n)), initialDraft());

  it("addSection appends after the last section, trims the name, mints a key, and marks dirty", () => {
    const d = reduce(withNames("Warm-up"), actions.addSection("  Main  "));
    expect(d.sections.map((s) => s.name)).toEqual(["Warm-up", "Main"]);
    expect(new Set(d.sections.map((s) => s.key)).size).toBe(2);
    expect(d.dirty).toBe(true);
  });

  it.each(["", "   ", "\n"])("a blank name %j is a no-op by reference", (name) => {
    const before = withNames("Warm-up");
    expect(reduce(before, actions.addSection(name))).toBe(before);
  });

  it(`the ${ROUTINE_SECTIONS_MAX}th section is the last: the next add is a no-op by reference`, () => {
    const full = withNames(...Array.from({ length: ROUTINE_SECTIONS_MAX }, (_, i) => `S${i}`));
    expect(full.sections).toHaveLength(ROUTINE_SECTIONS_MAX);
    expect(reduce(full, actions.addSection("One more"))).toBe(full);
  });

  it("duplicate names are legal", () => {
    expect(withNames("Main", "Main").sections.map((s) => s.name)).toEqual(["Main", "Main"]);
  });

  it("renameSection / setSectionNotes replace the text; an unchanged value is a no-op by reference (Done on an untouched sheet must not arm the guard)", () => {
    const base = { ...withNames("Main"), dirty: false };
    const key = base.sections[0]!.key;
    expect(reduce(base, actions.renameSection(key, "Main"))).toBe(base);
    expect(reduce(base, actions.setSectionNotes(key, ""))).toBe(base);
    const renamed = reduce(base, actions.renameSection(key, "Heavy"));
    expect(renamed.sections[0]!.name).toBe("Heavy");
    expect(renamed.dirty).toBe(true);
    expect(reduce(base, actions.setSectionNotes(key, "Pause every rep")).sections[0]!.notes).toBe("Pause every rep");
    expect(reduce(base, actions.renameSection("nope", "x"))).toBe(base);
    expect(reduce(base, actions.renameSection(key, "  "))).toBe(base); // a blank name is refused
  });
});

describe("10.3 AC3 — section move and delete", () => {
  it("moveSectionUp / Down swap with the neighbor and the items travel with the section", () => {
    const d = sectioned("x", ["W", "a b"], ["M", "c"]);
    const down = reduce(d, actions.moveSectionDown("W"));
    expect(sectionNames(down)).toBe("M,W");
    expect(shape(down)).toBe("-:x M:c W:a W:b");
    expect(down.dirty).toBe(true);
    expect(shape(reduce(down, actions.moveSectionUp("W")))).toBe("-:x W:a W:b M:c"); // W was last → moving up swaps back
    expect(sectionNames(reduce(down, actions.moveSectionUp("W")))).toBe("W,M");
  });

  it("at either edge they are no-ops by reference", () => {
    const d = sectioned("", ["W", "a"], ["M", "b"]);
    expect(reduce(d, actions.moveSectionUp("W"))).toBe(d);
    expect(reduce(d, actions.moveSectionDown("M"))).toBe(d);
    expect(reduce(d, actions.moveSectionUp("nope"))).toBe(d);
  });

  it("deleteSection keeps its exercises: loose, behind the existing loose ones, in their current order; name and note are discarded", () => {
    const d = { ...sectioned("x y", ["W", "a b"], ["M", "c"]), notes: "keep" };
    const out = reduce(d, actions.deleteSection("W"));
    expect(sectionNames(out)).toBe("M");
    expect(shape(out)).toBe("-:x -:y -:a -:b M:c");
    expect(out.dirty).toBe(true);
    expect(reduce(d, actions.deleteSection("nope"))).toBe(d);
  });

  it("a superset inside a deleted section stays a superset among the loose items and never merges with an adjacent loose superset", () => {
    // Loose superset (x1 y1) directly before the section's superset (a2 b2): distinct runs carry distinct numbers.
    const d = sectioned("x1 y1", ["W", "a2 b2 c"]);
    const out = reduce(d, actions.deleteSection("W"));
    expect(shape(out)).toBe("-:x1 -:y1 -:a2 -:b2 -:c");
    expect(out.sections).toEqual([]);
  });
});

describe("10.3 AC6 — settle: canonical order, runs split at boundaries, dense numbering", () => {
  it("moving a section reorders the flat list (loose first, sections in order, relative order kept)", () => {
    const d = sectioned("x", ["W", "a b"], ["M", "c d"]);
    expect(shape(reduce(d, actions.moveSectionDown("W")))).toBe("-:x M:c M:d W:a W:b");
  });

  it("numbers groups 1, 2, 3 … by first appearance after any change", () => {
    const d = sectioned("", ["W", "a5 b5 c"], ["M", "d9 e9"]);
    const swapped = reduce(d, actions.moveSectionDown("W")); // M first, then W: renumbered 1, 2
    expect(shape(swapped)).toBe("M:d1 M:e1 W:a2 W:b2 W:c");
    expect(shape(reduce(swapped, actions.moveSectionUp("W")))).toBe("W:a1 W:b1 W:c M:d2 M:e2");
  });

  it("a superset that straddles a boundary is split there; the halves of one dissolve", () => {
    // Built by hand (the reducer cannot produce it): a1 | b1 c — the section run is [b1 c], the loose run [a1].
    const bad = sectioned("a1", ["M", "b1 c"], ["W", ""]);
    const fixed = reduce(bad, actions.moveSectionDown("M")); // any changing action runs settle
    expect(shape(fixed)).toBe("-:a M:b M:c");
  });
});

describe("10.3 AC4 — item placement", () => {
  it("moveItemToSection appends to the end of the target section's run and clears the item's group", () => {
    const d = sectioned("x", ["W", ""], ["M", "b c d"]);
    const out = reduce(d, actions.moveItemToSection("d", "W"));
    expect(shape(out)).toBe("-:x W:d M:b M:c");
    expect(out.dirty).toBe(true);
    expect(out.unlinkNotice).toBe(false); // d was not linked
  });

  it("null = the end of the loose run, immediately before the first section", () => {
    const d = sectioned("x y", ["M", "b c"]);
    expect(shape(reduce(d, actions.moveItemToSection("c", null)))).toBe("-:x -:y -:c M:b");
  });

  it("moving to the item's current place is a no-op by reference; so is an unknown item or section", () => {
    const d = sectioned("x", ["M", "b c"]);
    expect(reduce(d, actions.moveItemToSection("b", "M"))).toBe(d);
    expect(reduce(d, actions.moveItemToSection("x", null))).toBe(d);
    expect(reduce(d, actions.moveItemToSection("nope", "M"))).toBe(d);
    expect(reduce(d, actions.moveItemToSection("x", "nope"))).toBe(d);
  });

  it("a linked item is unlinked, with the notice; a pair left with one member dissolves", () => {
    const d = sectioned("x", ["M", "b1 c1 d"]);
    const out = reduce(d, actions.moveItemToSection("b", null));
    expect(shape(out)).toBe("-:x -:b M:c M:d");
    expect(out.unlinkNotice).toBe(true);
    expect(reduce(out, actions.dismissUnlinkNotice()).unlinkNotice).toBe(false);
  });

  it("taking the middle of a run of three leaves a run of two", () => {
    const d = sectioned("", ["M", "b1 c1 d1"], ["W", ""]);
    expect(shape(reduce(d, actions.moveItemToSection("c", "W")))).toBe("M:b1 M:d1 W:c");
  });

  it("add appends to the end of the LAST section's run when sections exist, else loose (D3)", () => {
    const withSections = sectioned("x", ["W", "a"], ["M", "b"]);
    const added = reduce(withSections, actions.add(exerciseId(9)));
    expect(added.items.at(-1)!.sectionKey).toBe("M");
    expect(shape(added).startsWith("-:x W:a M:b M:")).toBe(true);
    const plain = reduce(initialDraft(), actions.add(exerciseId(9)));
    expect(plain.items[0]!.sectionKey).toBeNull();
  });

  it("add refuses past the item cap, as before", () => {
    let d = initialDraft();
    for (let i = 0; i < ROUTINE_ITEMS_MAX; i += 1) d = reduce(d, actions.add(exerciseId(1)));
    expect(reduce(d, actions.add(exerciseId(1)))).toBe(d);
  });
});

describe("10.3 AC5 — moves and links stay inside a section", () => {
  it("moveUp / moveDown act on the item's own run only and are no-ops at the run's edges", () => {
    const d = sectioned("a b", ["M", "c d"]);
    expect(shape(reduce(d, actions.moveUp("d")))).toBe("-:a -:b M:d M:c");
    expect(reduce(d, actions.moveUp("c"))).toBe(d); // first in M: does not cross into the loose run
    expect(reduce(d, actions.moveDown("b"))).toBe(d); // last loose: does not enter M
    expect(reduce(d, actions.moveDown("d"))).toBe(d);
    expect(shape(reduce(d, actions.moveDown("a")))).toBe("-:b -:a M:c M:d");
  });

  it("the 10.1 block-move rules apply inside the run (a grouped item at the run's edge leaves the group first)", () => {
    const d = sectioned("", ["M", "c1 d1 e"]);
    expect(shape(reduce(d, actions.moveDown("d")))).toBe("M:c M:e M:d"); // d leaves the pair, the pair of one dissolves
  });

  it("toggleLink between items of different sections is a no-op by reference; within a section it links", () => {
    const d = sectioned("a", ["M", "b c"]);
    expect(reduce(d, actions.toggleLink(0))).toBe(d);
    const linked = reduce(d, actions.toggleLink(1));
    expect(shape(linked)).toBe("-:a M:b1 M:c1");
    expect(isLinked(linked.items, 1)).toBe(true);
  });

  it("canLink refuses across a boundary and reports the 8-member cap per run, not per routine", () => {
    const d = sectioned("a", ["M", "b1 c1 d1 e1 f1 g1 h1 i1 j"]);
    expect(canLink(d, 0)).toEqual({ ok: false, reason: SECTION_LINK_REFUSAL });
    // b..i (indexes 1-8) are the eight members of the run; j (index 9) cannot join: index 8 is the boundary i|j.
    expect(canLink(d, 8)).toEqual({ ok: false, reason: LINK_CAP_MESSAGE });
    const other = sectioned("", ["M", "a1 b1"], ["W", "c d"]);
    expect(canLink(other, 2)).toEqual({ ok: true });
  });
});

/** Mulberry32: a small seeded PRNG so a failing step is reproducible. */
function rng(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function holds(d: Draft): string | null {
  const refs = d.items.map((i) => (i.sectionKey === null ? null : d.sections.findIndex((s) => s.key === i.sectionKey)));
  if (refs.some((r) => r === -1)) return "an item names a section that does not exist";
  if (sectionOrderViolations(refs).length > 0) return "section order";
  const groups = d.items.map((i) => i.supersetGroup);
  if (sectionSpanViolations(groups, refs).length > 0) return "a superset spans sections";
  const seen = new Set<number>();
  for (let i = 0; i < groups.length; ) {
    const g = groups[i] ?? null;
    if (g === null) { i += 1; continue; }
    if (seen.has(g)) return "a group appears in two runs";
    seen.add(g);
    let j = i;
    while (j < groups.length && groups[j] === g) j += 1;
    if (j - i < 2 || j - i > 8) return "a run is not 2-8";
    i = j;
  }
  const labels = [...seen];
  if (labels.some((g, k) => g !== k + 1)) return "numbers are not dense by first appearance";
  if (d.sections.length > ROUTINE_SECTIONS_MAX) return "too many sections";
  return null;
}

describe("10.3 AC6 — property: random sequences of every action keep the invariants", () => {
  it.each([1, 2, 3, 4])("seed %i: 500 random steps, invariants checked after each", (seed) => {
    const next = rng(seed);
    const pick = <T,>(xs: readonly T[]): T | undefined => xs[Math.floor(next() * xs.length)];
    let d = initialDraft();
    for (let step = 0; step < 500; step += 1) {
      const item = pick(d.items);
      const section = pick(d.sections);
      const roll = Math.floor(next() * 12);
      const a =
        roll === 0 ? actions.add(exerciseId(1 + Math.floor(next() * 3)))
        : roll === 1 && item ? actions.remove(item.key)
        : roll === 2 && item ? actions.moveUp(item.key)
        : roll === 3 && item ? actions.moveDown(item.key)
        : roll === 4 && d.items.length > 1 ? actions.toggleLink(Math.floor(next() * (d.items.length - 1)))
        : roll === 5 ? actions.addSection(`S${step}`)
        : roll === 6 && section ? actions.deleteSection(section.key)
        : roll === 7 && section ? actions.moveSectionUp(section.key)
        : roll === 8 && section ? actions.moveSectionDown(section.key)
        : roll === 9 && item ? actions.moveItemToSection(item.key, next() < 0.25 ? null : (pick(d.sections)?.key ?? null))
        : roll === 10 && section ? actions.renameSection(section.key, `R${step}`)
        : actions.add(exerciseId(1));
      d = reduce(d, a);
      expect(holds(d), `seed ${seed} step ${step}: ${a.type} → ${shape(d)}`).toBeNull();
    }
  });
});
