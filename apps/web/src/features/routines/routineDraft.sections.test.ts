import { describe, expect, it } from "vitest";
import { ROUTINE_SECTIONS_MAX } from "@sin/core";
import { makeRoutine, makeRoutineItem, makeRoutineSection, sectionId } from "../../test/workoutFixtures";
import { sectioned, sectionNames, shape } from "../../test/sectionedDraft";
import { actions, draftFromRoutine, initialDraft, reduce } from "./routineDraft";

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
