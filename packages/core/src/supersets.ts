import { SUPERSET_GROUP_MEMBERS_MAX, SUPERSET_GROUP_VALUE_MAX } from "./dto/routine.js";

/**
 * Spec 10.1 §6.2 — the superset rules shared by the routine editor and the live session. Pure: no
 * I/O, no DOM, no Node APIs (purity check).
 *
 * A slot list is in display order. A run is a maximal stretch of ≥ 2 consecutive slots with the same
 * non-null group; any other slot — null, a group of one, a member detached from its group — is
 * ungrouped (AC4). Rule outputs are canonical: runs labelled 1, 2, 3 … top to bottom, every other
 * slot null. Labels are equality classes, not stored numbers; numbering is the caller's job.
 */

export interface SessionSlot {
  readonly id: string;
  readonly group: number | null;
}

export type RunPosition = "none" | "first" | "middle" | "last";

export const LINK_CAP_MESSAGE = `A superset can have up to ${SUPERSET_GROUP_MEMBERS_MAX} exercises`;
export const NO_LINK_TARGET_MESSAGE = "No exercise to link with";

export type LinkResult = { readonly ok: true; readonly slots: SessionSlot[] } | { readonly ok: false; readonly reason: string };

/** Run labels 1, 2, 3 … top to bottom over runs only; `null` for every slot outside a run. */
export function runOrdinals(groups: readonly (number | null)[]): (number | null)[] {
  const out: (number | null)[] = [];
  let label = 0;
  groups.forEach((g, i) => {
    const withPrev = g !== null && i > 0 && groups[i - 1] === g;
    const withNext = g !== null && groups[i + 1] === g;
    if (!withPrev && !withNext) {
      out.push(null);
      return;
    }
    if (!withPrev) label += 1;
    out.push(label);
  });
  return out;
}

/** Where slot `index` sits in its bracket. A group of one draws no bracket (Spec 09 D10). */
export function runPosition(groups: readonly (number | null)[], index: number): RunPosition {
  const g = groups[index];
  if (g === null || g === undefined) return "none";
  const prev = index > 0 && groups[index - 1] === g;
  const next = groups[index + 1] === g;
  if (prev && next) return "middle";
  if (next) return "first";
  if (prev) return "last";
  return "none";
}

/** @internal Also used by the planner. */
export function canonical(slots: readonly SessionSlot[]): SessionSlot[] {
  const labels = runOrdinals(slots.map((x) => x.group));
  return slots.map((x, i) => ({ id: x.id, group: labels[i] ?? null }));
}

function bounds(slots: readonly SessionSlot[], index: number): [number, number] {
  const g = slots[index]!.group;
  if (g === null) return [index, index];
  let start = index;
  while (start > 0 && slots[start - 1]!.group === g) start -= 1;
  let end = index;
  while (end < slots.length - 1 && slots[end + 1]!.group === g) end += 1;
  return [start, end];
}

const maxLabel = (slots: readonly SessionSlot[]): number => slots.reduce((max, x) => Math.max(max, x.group ?? 0), 0);

function swap(slots: readonly SessionSlot[], i: number, j: number): SessionSlot[] {
  const out = [...slots];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

export function isLinked(slots: readonly SessionSlot[], index: number): boolean {
  const a = slots[index];
  const b = slots[index + 1];
  return a !== undefined && b !== undefined && a.group !== null && a.group === b.group;
}

export function canLinkRule(slots: readonly SessionSlot[], index: number): { ok: true } | { ok: false; reason: string } {
  if (index < 0 || index >= slots.length - 1) return { ok: false, reason: NO_LINK_TARGET_MESSAGE };
  if (isLinked(slots, index)) return { ok: true };
  const c = canonical(slots);
  const [start] = bounds(c, index);
  const [, end] = bounds(c, index + 1);
  return end - start + 1 > SUPERSET_GROUP_MEMBERS_MAX ? { ok: false, reason: LINK_CAP_MESSAGE } : { ok: true };
}

/** Join whatever sits on either side of the boundary below `index` (AC1). */
export function linkRule(slots: readonly SessionSlot[], index: number): LinkResult {
  const allowed = canLinkRule(slots, index);
  if (!allowed.ok) return allowed;
  const c = canonical(slots);
  if (isLinked(c, index)) return { ok: true, slots: c };
  const [start] = bounds(c, index);
  const [, end] = bounds(c, index + 1);
  const label = c[index]!.group ?? c[index + 1]!.group ?? maxLabel(c) + 1;
  return { ok: true, slots: canonical(c.map((x, k) => (k >= start && k <= end ? { ...x, group: label } : x))) };
}

/** Split the run at the boundary below `index`; a side of one becomes ungrouped (AC2). */
export function unlinkRule(slots: readonly SessionSlot[], index: number): SessionSlot[] {
  const c = canonical(slots);
  if (!isLinked(c, index)) return c;
  const [, end] = bounds(c, index);
  const fresh = maxLabel(c) + 1;
  return canonical(c.map((x, k) => (k > index && k <= end ? { ...x, group: fresh } : x)));
}

/**
 * Block moves (AC3, 10.0 D8). Within a run: swap. A grouped slot at its run's edge moving outward
 * leaves the group first, then moves like an ungrouped slot. An ungrouped slot swaps with an
 * ungrouped neighbour, or jumps the neighbour's whole run — it never lands inside a group.
 */
export function moveRule(slots: readonly SessionSlot[], index: number, dir: -1 | 1): SessionSlot[] | null {
  const j = index + dir;
  if (index < 0 || index >= slots.length || j < 0 || j >= slots.length) return null;
  const c = canonical(slots);
  const me = c[index]!;
  const next = c[j]!;
  if (me.group !== null && next.group === me.group) return canonical(swap(c, index, j));
  const free: SessionSlot = { id: me.id, group: null };
  if (next.group === null) {
    const out = swap(c, index, j);
    out[j] = free;
    return canonical(out);
  }
  const [start, end] = bounds(c, j);
  const rest = c.filter((_, k) => k !== index);
  rest.splice(dir === -1 ? start : end, 0, free);
  return canonical(rest);
}

export type SessionOp =
  | { readonly type: "toggleLink"; readonly index: number }
  | { readonly type: "move"; readonly id: string; readonly direction: "up" | "down" };

export type SessionPatch =
  | { readonly id: string; readonly supersetGroup: number | null }
  | { readonly id: string; readonly position: number };

export type SessionPlan =
  | { readonly ok: true; readonly patches: SessionPatch[]; readonly next: SessionSlot[] }
  | { readonly ok: false; readonly reason: "cap"; readonly message: string }
  | { readonly ok: false; readonly reason: "no-free-group" };

type Applied = { result: SessionSlot[]; movedId: string | null } | { cap: string } | null;

function applyRule(current: readonly SessionSlot[], op: SessionOp): Applied {
  if (op.type === "toggleLink") {
    if (isLinked(current, op.index)) return { result: unlinkRule(current, op.index), movedId: null };
    const linked = linkRule(current, op.index);
    if (linked.ok) return { result: linked.slots, movedId: null };
    return linked.reason === LINK_CAP_MESSAGE ? { cap: linked.reason } : null;
  }
  const index = current.findIndex((x) => x.id === op.id);
  const result = moveRule(current, index, op.direction === "up" ? -1 : 1);
  return result ? { result, movedId: op.id } : null;
}

/** Label → member ids, in list order (labels iterate top to bottom: they are canonical). */
function members(slots: readonly SessionSlot[]): Map<number, string[]> {
  const out = new Map<number, string[]>();
  for (const x of slots) if (x.group !== null) out.set(x.group, [...(out.get(x.group) ?? []), x.id]);
  return out;
}

function smallestFree(taken: ReadonlySet<number>): number | null {
  for (let n = 1; n <= SUPERSET_GROUP_VALUE_MAX; n++) if (!taken.has(n)) return n;
  return null;
}

function isContiguous(groups: readonly (number | null)[]): boolean {
  const seen = new Set<number>();
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i]!;
    if (g === null || (i > 0 && groups[i - 1] === g)) continue;
    if (seen.has(g)) return false;
    seen.add(g);
  }
  return true;
}

/** Order group patches so every prefix keeps each group contiguous where that is possible (AC9). */
function orderForContiguity(
  current: readonly SessionSlot[],
  patches: { id: string; supersetGroup: number | null }[],
): { id: string; supersetGroup: number | null }[] {
  const groups = current.map((x) => x.group);
  const at = new Map(current.map((x, i) => [x.id, i]));
  const remaining = [...patches].sort((a, b) => at.get(a.id)! - at.get(b.id)!);
  const out: { id: string; supersetGroup: number | null }[] = [];
  while (remaining.length > 0) {
    let pick = remaining.findIndex((p) => {
      const trial = [...groups];
      trial[at.get(p.id)!] = p.supersetGroup;
      return isContiguous(trial);
    });
    if (pick < 0) pick = 0; // a tolerant input that is already non-contiguous: any order
    const [p] = remaining.splice(pick, 1);
    groups[at.get(p!.id)!] = p!.supersetGroup;
    out.push(p!);
  }
  return out;
}

/**
 * Spec 10.1 AC7–AC9: apply the shared rule, then diff against the stored numbers. Untouched runs keep
 * their numbers; a touched run keeps the number of the stored run it shares most members with (tie:
 * the upper) when no slot outside that run carries it; anything else takes the smallest number in
 * 1–99 carried by no slot. Group patches come first, ordered for contiguity; a move's position patch
 * is last. `current` is in position order (dense positions, Spec 05.0 D41).
 */
export function planSessionChange(current: readonly SessionSlot[], op: SessionOp): SessionPlan {
  const applied = applyRule(current, op);
  if (applied === null) return { ok: true, patches: [], next: [...current] };
  if ("cap" in applied) return { ok: false, reason: "cap", message: applied.cap };
  const { result, movedId } = applied;

  const stored = new Map(current.map((x) => [x.id, x.group]));
  const before = canonical(current);
  const runOf = new Map(before.map((x) => [x.id, x.group]));
  const runNumber = new Map<number, number>();
  before.forEach((x, i) => {
    if (x.group !== null) runNumber.set(x.group, current[i]!.group!);
  });
  const runMembers = members(before);
  const classes = members(result);
  const taken = new Set(current.flatMap((x) => (x.group === null ? [] : [x.group])));
  const final = new Map<string, number | null>();
  const resultIndex = new Map(result.map((x, i) => [x.id, i]));

  // 1. A class whose members are exactly one stored run is untouched: it keeps its number.
  const touched: number[] = [];
  for (const [label, ids] of classes) {
    const source = runOf.get(ids[0]!) ?? null;
    const run = source === null ? undefined : runMembers.get(source);
    if (run !== undefined && run.length === ids.length && ids.every((id) => run.includes(id))) {
      for (const id of ids) final.set(id, runNumber.get(source!)!);
    } else {
      touched.push(label);
    }
  }

  // 2. Each touched class claims the stored run it shares most members with (tie: the upper run);
  //    per run, the claimant with most members wins (tie: the upper class) if the number is exclusive.
  const claims = new Map<number, { cls: number; count: number; first: number }[]>();
  for (const cls of touched) {
    const ids = classes.get(cls)!;
    let best: { run: number; count: number } | null = null;
    for (const [run, runIds] of runMembers) {
      const count = ids.filter((id) => runIds.includes(id)).length;
      if (count > 0 && (best === null || count > best.count)) best = { run, count };
    }
    if (best) claims.set(best.run, [...(claims.get(best.run) ?? []), { cls, count: best.count, first: resultIndex.get(ids[0]!)! }]);
  }
  const keeps = new Map<number, number>();
  for (const [run, claimants] of claims) {
    claimants.sort((a, b) => b.count - a.count || a.first - b.first);
    const n = runNumber.get(run)!;
    const runIds = runMembers.get(run)!;
    if (current.every((x) => x.group !== n || runIds.includes(x.id))) keeps.set(claimants[0]!.cls, n);
  }

  // 3. Every other touched class takes the smallest free number.
  for (const cls of touched) {
    let n = keeps.get(cls);
    if (n === undefined) {
      const free = smallestFree(taken);
      if (free === null) return { ok: false, reason: "no-free-group" };
      taken.add(free);
      n = free;
    }
    for (const id of classes.get(cls)!) final.set(id, n);
  }

  // 4. Ungrouped in the result: a former run member leaves with null; any other slot keeps its value.
  for (const x of result) {
    if (x.group === null) final.set(x.id, runOf.get(x.id) !== null ? null : (stored.get(x.id) ?? null));
  }

  // 5. Tolerant inputs: two different units must never end up adjacent with one number.
  const unit = (x: SessionSlot) => (x.group === null ? `slot:${x.id}` : `run:${x.group}`);
  for (let i = 0; i + 1 < result.length; i++) {
    const upper = result[i]!;
    const lower = result[i + 1]!;
    const n = final.get(upper.id) ?? null;
    if (n === null || n !== final.get(lower.id) || unit(upper) === unit(lower)) continue;
    if (lower.group === null) {
      final.set(lower.id, null);
    } else {
      const free = smallestFree(taken);
      if (free === null) return { ok: false, reason: "no-free-group" };
      taken.add(free);
      for (const id of classes.get(lower.group)!) final.set(id, free);
    }
  }

  const next = result.map((x) => ({ id: x.id, group: final.get(x.id) ?? null }));
  const groupPatches = next
    .filter((x) => x.group !== (stored.get(x.id) ?? null))
    .map((x) => ({ id: x.id, supersetGroup: x.group }));
  const patches: SessionPatch[] = orderForContiguity(current, groupPatches);
  if (movedId !== null) {
    const from = current.findIndex((x) => x.id === movedId);
    const to = next.findIndex((x) => x.id === movedId);
    if (from !== to) patches.push({ id: movedId, position: to });
  }
  return { ok: true, patches, next };
}
