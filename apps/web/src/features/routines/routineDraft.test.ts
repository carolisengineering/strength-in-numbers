// apps/web/src/features/routines/routineDraft.test.ts
import { describe, expect, it } from "vitest";
import { normalizeSupersetGroups, ROUTINE_ITEMS_MAX, type Routine } from "@sin/core";
import { exerciseId } from "../../test/catalogFixtures";
import { makeRoutine, makeRoutineItem } from "../../test/workoutFixtures";
import {
  actions,
  canLink,
  draftFromRoutine,
  initialDraft,
  isLinked,
  LINK_CAP_MESSAGE,
  reduce,
  runPosition,
  type Draft,
  type DraftAction,
  type DraftItem,
} from "./routineDraft";

const TOKEN = /^([a-z]+)(\d*)$/;

/** "a b1 c1 d" → a draft (dirty false) whose item keys are the letters. */
function draftOf(spec: string, overrides: Partial<Draft> = {}): Draft {
  const items: DraftItem[] = spec
    .split(/\s+/)
    .filter(Boolean)
    .map((token, i) => {
      const m = TOKEN.exec(token)!;
      return {
        key: m[1]!,
        exerciseId: exerciseId(i + 1),
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetRpe: null,
        restSeconds: null,
        notes: null,
        supersetGroup: m[2] === "" ? null : Number(m[2]),
      };
    });
  return { name: "Push A", notes: "", items, dirty: false, adjusted: false, ...overrides };
}

const shape = (d: Draft) => d.items.map((i) => `${i.key}${i.supersetGroup ?? ""}`).join(" ");

function invariantHolds(d: Draft): boolean {
  const groups = d.items.map((i) => i.supersetGroup);
  if (JSON.stringify(normalizeSupersetGroups(groups)) !== JSON.stringify(groups)) return false;
  const seen = new Set<number>();
  for (let i = 0; i < groups.length; ) {
    const g = groups[i];
    if (g === null) { i += 1; continue; }
    if (seen.has(g)) return false; // the group appears in two separate runs
    seen.add(g);
    let j = i;
    while (j < groups.length && groups[j] === g) j += 1;
    const len = j - i;
    if (len < 2 || len > 8) return false;
    i = j;
  }
  return true;
}

describe("10.0 AC1 — draft basics", () => {
  it("starts empty and clean", () => {
    expect(initialDraft()).toEqual({ name: "", notes: "", items: [], dirty: false, adjusted: false });
  });

  it("every change sets dirty; a no-op returns the same reference", () => {
    const d = draftOf("a b");
    expect(reduce(d, actions.rename("Pull")).dirty).toBe(true);
    expect(reduce(d, actions.setNotes("x")).dirty).toBe(true);
    expect(reduce(d, actions.rename("Push A"))).toBe(d);
    expect(reduce(d, actions.moveUp("a"))).toBe(d);
    expect(reduce(d, actions.moveDown("b"))).toBe(d);
    expect(reduce(d, actions.remove("zz"))).toBe(d);
  });

  it("add appends an ungrouped item with empty targets and a unique key; duplicates allowed", () => {
    let d = draftOf("a1 b1");
    d = reduce(d, actions.add(exerciseId(1)));
    d = reduce(d, actions.add(exerciseId(1)));
    expect(d.items).toHaveLength(4);
    const [, , third, fourth] = d.items;
    expect(third).toMatchObject({ exerciseId: exerciseId(1), supersetGroup: null, targetSets: null, notes: null });
    expect(new Set(d.items.map((i) => i.key)).size).toBe(4);
    expect(fourth!.key).not.toBe(third!.key);
    expect(d.dirty).toBe(true);
  });

  it(`add is a no-op at ${ROUTINE_ITEMS_MAX} items`, () => {
    let d = initialDraft();
    for (let i = 0; i < ROUTINE_ITEMS_MAX; i += 1) d = reduce(d, actions.add(exerciseId(1)));
    expect(reduce(d, actions.add(exerciseId(2)))).toBe(d);
  });

  it("keys stay stable across moves, edits and group changes", () => {
    let d = draftOf("a b c");
    const keys = () => [...d.items.map((i) => i.key)].sort();
    d = reduce(d, actions.moveDown("a"));
    d = reduce(d, actions.toggleLink(0));
    d = reduce(d, actions.setTargets("c", { targetSets: 3, targetRepsLow: 8, targetRepsHigh: 10, targetRpe: 8, restSeconds: 90 }, "slow"));
    expect(keys()).toEqual(["a", "b", "c"]);
  });

  it("setTargets replaces one item's targets and notes only", () => {
    const d = reduce(draftOf("a1 b1"), actions.setTargets("b", { targetSets: 3, targetRepsLow: 8, targetRepsHigh: 8, targetRpe: 8.5, restSeconds: 0 }, null));
    expect(d.items[1]).toMatchObject({ key: "b", supersetGroup: 1, targetSets: 3, targetRpe: 8.5, restSeconds: 0, notes: null });
    expect(d.items[0]).toEqual(draftOf("a1 b1").items[0]);
  });
});

describe("10.0 AC2 — linking and unlinking", () => {
  it.each<[string, number, string]>([
    ["a b", 0, "a1 b1"],
    ["a b1 c1", 0, "a1 b1 c1"],
    ["a1 b1 c", 1, "a1 b1 c1"],
    ["a1 b1 c2 d2", 1, "a1 b1 c1 d1"],
    ["a1 b1", 0, "a b"],
    ["a1 b1 c1", 0, "a b1 c1"],
    ["a1 b1 c1", 1, "a1 b1 c"],
    ["a1 b1 c1 d1", 1, "a1 b1 c2 d2"],
  ])("%s toggleLink(%i) → %s", (start, index, end) => {
    const d = reduce(draftOf(start), actions.toggleLink(index));
    expect(shape(d)).toBe(end);
    expect(invariantHolds(d)).toBe(true);
  });

  it("derives linked-to-next from the groups", () => {
    const d = draftOf("a1 b1 c");
    expect(isLinked(d.items, 0)).toBe(true);
    expect(isLinked(d.items, 1)).toBe(false);
  });

  it("refuses a merge past 8 and says why", () => {
    const d = draftOf("a1 b1 c1 d1 e1 f1 g1 h1 i");
    expect(canLink(d, 7)).toEqual({ ok: false, reason: LINK_CAP_MESSAGE });
    expect(reduce(d, actions.toggleLink(7))).toBe(d);
    expect(canLink(d, 0)).toEqual({ ok: true }); // unlinking is always allowed
  });

  it("is a no-op on the last item or out of range", () => {
    const d = draftOf("a b");
    expect(reduce(d, actions.toggleLink(1))).toBe(d);
    expect(reduce(d, actions.toggleLink(-1))).toBe(d);
    expect(reduce(d, actions.toggleLink(9))).toBe(d);
  });
});

describe("10.0 AC3 — moves keep groups contiguous", () => {
  const up = (key: string): DraftAction => actions.moveUp(key);
  const down = (key: string): DraftAction => actions.moveDown(key);
  it.each<[string, DraftAction, string]>([
    ["a1 b1 c", up("b"), "b1 a1 c"],
    ["a1 b1 c1", down("a"), "b1 a1 c1"],
    ["x a1 b1 c1", up("a"), "a x b1 c1"],
    ["x a1 b1", up("a"), "a x b"],
    ["a1 b1 x", down("b"), "a x b"],
    ["a1 b1 c", up("c"), "c a1 b1"],
    ["c a1 b1 d", down("c"), "a1 b1 c d"],
    ["a1 b1 c2 d2", up("c"), "c a1 b1 d"],
    ["a1 b1 c2 d2", down("b"), "a c1 d1 b"],
    ["a b c", up("b"), "b a c"],
  ])("%s %j → %s", (start, action, end) => {
    const d = reduce(draftOf(start), action);
    expect(shape(d)).toBe(end);
    expect(invariantHolds(d)).toBe(true);
    expect(d.dirty).toBe(true);
  });
});

describe("10.0 AC4 — removal and normalisation", () => {
  it.each<[string, string, string]>([
    ["a1 b1 c", "a", "b c"],
    ["a1 b1 c1", "b", "a1 c1"],
    ["a1 b1 c2 d2", "b", "a c1 d1"],
  ])("%s remove %s → %s", (start, key, end) => {
    expect(shape(reduce(draftOf(start), actions.remove(key)))).toBe(end);
  });

  it("holds the invariant after every step of a long seeded random sequence", () => {
    let seed = 0x5eed;
    const rand = () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    let d = initialDraft();
    for (let step = 0; step < 2000; step += 1) {
      const keys = d.items.map((i) => i.key);
      const pick = () => keys[Math.floor(rand() * keys.length)]!;
      const roll = rand();
      let action: DraftAction;
      if (keys.length === 0 || roll < 0.2) action = actions.add(exerciseId(1 + Math.floor(rand() * 5)));
      else if (roll < 0.3) action = actions.remove(pick());
      else if (roll < 0.5) action = actions.moveUp(pick());
      else if (roll < 0.7) action = actions.moveDown(pick());
      else action = actions.toggleLink(Math.floor(rand() * keys.length));
      d = reduce(d, action);
      expect(invariantHolds(d), `step ${step}: ${shape(d)}`).toBe(true);
    }
  });
});

describe("10.0 AC5 — loading a routine", () => {
  const routineWith = (groups: (number | null)[]): Routine =>
    makeRoutine({
      name: "Pull B",
      notes: "Heavy day",
      items: groups.map((supersetGroup, position) =>
        makeRoutineItem({ position, exerciseId: exerciseId(position + 1), supersetGroup, targetRpe: position === 0 ? 8.5 : null }),
      ),
    });

  it("maps items in position order with fresh keys, clean", () => {
    const routine = routineWith([1, 1, null]);
    const shuffled = { ...routine, items: [...routine.items].reverse() };
    const d = draftFromRoutine(shuffled);
    expect(d).toMatchObject({ name: "Pull B", notes: "Heavy day", dirty: false, adjusted: false });
    expect(d.items.map((i) => i.exerciseId)).toEqual([exerciseId(1), exerciseId(2), exerciseId(3)]);
    expect(d.items[0]!.targetRpe).toBe(8.5);
    expect(d.items.map((i) => i.key)).not.toContain(routine.items[0]!.id);
    expect(d.items.map((i) => i.supersetGroup)).toEqual([1, 1, null]);
  });

  it("splits a non-contiguous group, marks adjusted and dirty", () => {
    const d = draftFromRoutine(routineWith([1, null, 1, 1]));
    expect(d.items.map((i) => i.supersetGroup)).toEqual([null, null, 1, 1]);
    expect(d).toMatchObject({ adjusted: true, dirty: true });
    expect(reduce(d, actions.dismissAdjusted()).adjusted).toBe(false);
  });

  it("null notes load as an empty string", () => {
    expect(draftFromRoutine(makeRoutine({ notes: null })).notes).toBe("");
  });
});

describe("10.0 AC33 — markRetired flags rows by key without touching dirty", () => {
  it("flags only the named keys", () => {
    const d = reduce(draftOf("a b c", { dirty: true }), actions.markRetired(["b"]));
    expect(d.items.map((i) => i.retired ?? false)).toEqual([false, true, false]);
    expect(d.dirty).toBe(true);
    expect(reduce(d, actions.markRetired(["zz"]))).toBe(d);
  });
});

describe("10.0 AC18 — runPosition draws the bracket", () => {
  it("first / middle / last / none; a group of one is none", () => {
    const groups = [1, 1, 1, null, 2, 3];
    expect(groups.map((_, i) => runPosition(groups, i))).toEqual(["first", "middle", "last", "none", "none", "none"]);
  });
});
