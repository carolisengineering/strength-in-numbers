import { SUPERSET_GROUP_MEMBERS_MAX } from "./dto/routine.js";

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
