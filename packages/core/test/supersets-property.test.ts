import { describe, expect, it } from "vitest";
import { isLinked, linkRule, moveRule, planSessionChange, runOrdinals, unlinkRule, type SessionOp, type SessionSlot } from "../src/supersets.js";
import { prng } from "./helpers/history-generator.js";
import { applyPatches, contiguous } from "./helpers/supersets.js";

const SEEDS = Array.from({ length: 600 }, (_, i) => i + 1);
const groupsOf = (slots: readonly SessionSlot[]) => slots.map((x) => x.group);

/** Invariant lists: contiguous runs of 2–8 with distinct numbers (dense or sparse), mixed with ungrouped slots. */
function invariantList(rnd: () => number): SessionSlot[] {
  const n = 1 + Math.floor(rnd() * 20);
  const sparse = rnd() < 0.5;
  const used = new Set<number>();
  const out: SessionSlot[] = [];
  let next = 1;
  while (out.length < n) {
    const room = n - out.length;
    if (room >= 2 && rnd() < 0.5) {
      const size = Math.min(room, 2 + Math.floor(rnd() * 7));
      let g = sparse ? 1 + Math.floor(rnd() * 99) : next++;
      while (used.has(g)) g = (g % 99) + 1;
      used.add(g);
      for (let k = 0; k < size; k++) out.push({ id: `s${out.length}`, group: g });
    } else {
      out.push({ id: `s${out.length}`, group: null });
    }
  }
  return out;
}

function tolerantList(rnd: () => number): SessionSlot[] {
  const pool = [null, 1, 2, 3, 40];
  return Array.from({ length: 1 + Math.floor(rnd() * 12) }, (_, i) => ({ id: `t${i}`, group: pool[Math.floor(rnd() * pool.length)]! }));
}

function randomOp(rnd: () => number, list: readonly SessionSlot[]): SessionOp {
  if (rnd() < 0.5) return { type: "toggleLink", index: Math.floor(rnd() * Math.max(1, list.length - 1)) };
  return { type: "move", id: list[Math.floor(rnd() * list.length)]!.id, direction: rnd() < 0.5 ? "up" : "down" };
}

/** The rule's canonical result, or null when the op is a no-op / refused. */
function ruleResult(list: readonly SessionSlot[], op: SessionOp): SessionSlot[] | null {
  if (op.type === "toggleLink") {
    if (isLinked(list, op.index)) return unlinkRule(list, op.index);
    const r = linkRule(list, op.index);
    return r.ok ? r.slots : null;
  }
  return moveRule(list, list.findIndex((x) => x.id === op.id), op.direction === "up" ? -1 : 1);
}

function noOpFree(current: readonly SessionSlot[], plan: { patches: readonly ({ id: string } & ({ supersetGroup: number | null } | { position: number }))[] }) {
  for (const p of plan.patches) {
    if ("position" in p) expect(current.findIndex((x) => x.id === p.id)).not.toBe(p.position);
    else expect(current.find((x) => x.id === p.id)!.group).not.toBe(p.supersetGroup);
  }
}

describe("10.1 AC10 — planSessionChange properties (invariant inputs)", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const rnd = prng(seed);
    const current = invariantList(rnd);
    const op = randomOp(rnd, current);
    const plan = planSessionChange(current, op);
    const rule = ruleResult(current, op);
    if (!plan.ok) {
      expect(plan.reason).toBe("cap");
      return;
    }
    expect(applyPatches(current, plan.patches)).toEqual(plan.next);
    if (rule === null) {
      expect(plan.patches).toEqual([]);
      return;
    }
    expect(plan.next.map((x) => x.id)).toEqual(rule.map((x) => x.id));
    expect(runOrdinals(groupsOf(plan.next))).toEqual(groupsOf(rule));
    // Every run: contiguous, a number of its own, size 2–8.
    expect(contiguous(groupsOf(plan.next))).toBe(true);
    const counts = new Map<number, number>();
    for (const g of groupsOf(plan.next)) if (g !== null) counts.set(g, (counts.get(g) ?? 0) + 1);
    for (const size of counts.values()) expect(size >= 2 && size <= 8).toBe(true);
    // Untouched runs keep their numbers.
    for (const g of new Set(groupsOf(current).filter((x): x is number => x !== null))) {
      const before = current.filter((x) => x.group === g).map((x) => x.id).sort();
      const after = plan.next.filter((x) => before.includes(x.id));
      const same = new Set(after.map((x) => x.group)).size === 1 && plan.next.filter((x) => x.group === after[0]!.group).length === before.length;
      if (same && after[0]!.group !== null) expect(after[0]!.group).toBe(g);
    }
    noOpFree(current, plan);
    for (let k = 0; k <= plan.patches.length; k++) expect(contiguous(groupsOf(applyPatches(current, plan.patches.slice(0, k))))).toBe(true);
  });
});

describe("10.1 AC10 — planSessionChange properties (tolerant inputs)", () => {
  it.each(SEEDS)("seed %i", (seed) => {
    const rnd = prng(seed);
    const current = tolerantList(rnd);
    const op = randomOp(rnd, current);
    const plan = planSessionChange(current, op);
    if (!plan.ok) return;
    expect(applyPatches(current, plan.patches)).toEqual(plan.next);
    noOpFree(current, plan);
    const rule = ruleResult(current, op);
    if (rule === null) return;
    // The runs in next are exactly the rule's runs; a touched run's number is carried only by its members.
    expect(runOrdinals(groupsOf(plan.next))).toEqual(groupsOf(rule));
    const ordinals = runOrdinals(groupsOf(plan.next));
    const currentRuns = runOrdinals(groupsOf(current));
    for (const label of new Set(ordinals.filter((x): x is number => x !== null))) {
      const ids = plan.next.filter((_, i) => ordinals[i] === label).map((x) => x.id);
      const n = plan.next.find((x) => x.id === ids[0])!.group;
      const touched = !current.some((x, i) => currentRuns[i] !== null && ids.every((id) => current.filter((_, k) => currentRuns[k] === currentRuns[i]).some((y) => y.id === id)) && current.filter((_, k) => currentRuns[k] === currentRuns[i]).length === ids.length);
      if (touched) expect(plan.next.filter((x) => x.group === n).map((x) => x.id).sort()).toEqual([...ids].sort());
    }
  });
});
