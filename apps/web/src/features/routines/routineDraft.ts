import { normalizeSupersetGroups, ROUTINE_ITEMS_MAX, SUPERSET_GROUP_MEMBERS_MAX, type Routine } from "@sin/core";
import type { Targets } from "./targetFormat";

/**
 * The routine editor's draft (Spec 10.0 §6.2, AC1–AC5). Pure — no React. Private to the editor: `key`s
 * are client-only and never reach the server, and server item ids are discarded on load (they are not
 * stable across a PUT, Spec 09 AC13).
 *
 * Invariant after every action: each non-null `supersetGroup` is one contiguous run of 2–8 items,
 * numbered 1, 2, 3 … by first appearance — exactly what the server will store. `settle` enforces it
 * once, at the end of every changing branch, so no single action can forget a rule (D8).
 */

export interface DraftItem extends Targets {
  readonly key: string;
  readonly exerciseId: string;
  readonly notes: string | null;
  readonly supersetGroup: number | null;
  /** Set when the server answered `409 exercise-retired` for this row (AC33). */
  readonly retired?: true;
}

export interface Draft {
  readonly name: string;
  readonly notes: string;
  readonly items: readonly DraftItem[];
  readonly dirty: boolean;
  /** `load` had to split a non-contiguous group (AC5); the editor shows a notice until dismissed. */
  readonly adjusted: boolean;
}

export type DraftAction =
  | { readonly type: "rename"; readonly name: string }
  | { readonly type: "setNotes"; readonly notes: string }
  | { readonly type: "add"; readonly exerciseId: string; readonly key: string }
  | { readonly type: "remove"; readonly key: string }
  | { readonly type: "moveUp"; readonly key: string }
  | { readonly type: "moveDown"; readonly key: string }
  | { readonly type: "setTargets"; readonly key: string; readonly targets: Targets; readonly notes: string | null }
  | { readonly type: "toggleLink"; readonly index: number }
  | { readonly type: "load"; readonly routine: Routine; readonly keys: readonly string[] }
  | { readonly type: "markRetired"; readonly keys: readonly string[] }
  | { readonly type: "dismissAdjusted" };

export const LINK_CAP_MESSAGE = `A superset can have up to ${SUPERSET_GROUP_MEMBERS_MAX} exercises`;

const newKey = (): string => crypto.randomUUID();

/** Action creators. Keys are minted here, so `reduce` stays pure and deterministic. */
export const actions = {
  rename: (name: string): DraftAction => ({ type: "rename", name }),
  setNotes: (notes: string): DraftAction => ({ type: "setNotes", notes }),
  add: (exerciseId: string): DraftAction => ({ type: "add", exerciseId, key: newKey() }),
  remove: (key: string): DraftAction => ({ type: "remove", key }),
  moveUp: (key: string): DraftAction => ({ type: "moveUp", key }),
  moveDown: (key: string): DraftAction => ({ type: "moveDown", key }),
  setTargets: (key: string, targets: Targets, notes: string | null): DraftAction => ({ type: "setTargets", key, targets, notes }),
  toggleLink: (index: number): DraftAction => ({ type: "toggleLink", index }),
  load: (routine: Routine): DraftAction => ({ type: "load", routine, keys: routine.items.map(() => newKey()) }),
  markRetired: (keys: readonly string[]): DraftAction => ({ type: "markRetired", keys }),
  dismissAdjusted: (): DraftAction => ({ type: "dismissAdjusted" }),
};

export function initialDraft(): Draft {
  return { name: "", notes: "", items: [], dirty: false, adjusted: false };
}

export function draftFromRoutine(routine: Routine): Draft {
  return reduce(initialDraft(), actions.load(routine));
}

/** Runs of one become ungrouped; a group seen in two runs becomes two groups; then dense 1, 2, 3 …. */
function settle(items: readonly DraftItem[]): DraftItem[] {
  const labels: (number | null)[] = [];
  let label = 0;
  items.forEach((item, i) => {
    const g = item.supersetGroup;
    if (g === null) {
      labels.push(null);
      return;
    }
    if (i === 0 || items[i - 1]!.supersetGroup !== g) label += 1;
    labels.push(label);
  });
  const sizes = new Map<number, number>();
  for (const l of labels) if (l !== null) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const dense = normalizeSupersetGroups(labels.map((l) => (l !== null && sizes.get(l) === 1 ? null : l)));
  return items.map((item, i) => (item.supersetGroup === dense[i] ? item : { ...item, supersetGroup: dense[i]! }));
}

function runBounds(items: readonly DraftItem[], index: number): [number, number] {
  const g = items[index]!.supersetGroup;
  if (g === null) return [index, index];
  let start = index;
  while (start > 0 && items[start - 1]!.supersetGroup === g) start -= 1;
  let end = index;
  while (end < items.length - 1 && items[end + 1]!.supersetGroup === g) end += 1;
  return [start, end];
}

const maxGroup = (items: readonly DraftItem[]): number =>
  items.reduce((max, item) => Math.max(max, item.supersetGroup ?? 0), 0);

export function isLinked(items: readonly DraftItem[], index: number): boolean {
  const a = items[index];
  const b = items[index + 1];
  return a !== undefined && b !== undefined && a.supersetGroup !== null && a.supersetGroup === b.supersetGroup;
}

export function canLink(state: Draft, index: number): { ok: true } | { ok: false; reason: string } {
  const { items } = state;
  if (index < 0 || index >= items.length - 1) return { ok: false, reason: "No exercise to link with" };
  if (isLinked(items, index)) return { ok: true };
  const [start] = runBounds(items, index);
  const [, end] = runBounds(items, index + 1);
  return end - start + 1 > SUPERSET_GROUP_MEMBERS_MAX ? { ok: false, reason: LINK_CAP_MESSAGE } : { ok: true };
}

function toggleLink(state: Draft, index: number): DraftItem[] | null {
  const { items } = state;
  if (index < 0 || index >= items.length - 1) return null;
  if (isLinked(items, index)) {
    // Split: everything after the boundary in this run gets a fresh label; `settle` ungroups a side of one.
    const [, end] = runBounds(items, index);
    const fresh = maxGroup(items) + 1;
    return items.map((item, k) => (k > index && k <= end ? { ...item, supersetGroup: fresh } : item));
  }
  if (!canLink(state, index).ok) return null;
  const [start] = runBounds(items, index);
  const [, end] = runBounds(items, index + 1);
  const label = items[index]!.supersetGroup ?? items[index + 1]!.supersetGroup ?? maxGroup(items) + 1;
  return items.map((item, k) => (k >= start && k <= end ? { ...item, supersetGroup: label } : item));
}

function swap(items: readonly DraftItem[], i: number, j: number): DraftItem[] {
  const out = [...items];
  [out[i], out[j]] = [out[j]!, out[i]!];
  return out;
}

/**
 * Block moves (D8). Within a run: swap. A grouped item at its run's edge moving outward leaves the group
 * first, then moves like an ungrouped item. An ungrouped item swaps with an ungrouped neighbour, or jumps
 * the neighbour's whole run — it never lands inside a group.
 */
function move(items: readonly DraftItem[], index: number, dir: -1 | 1): DraftItem[] | null {
  const j = index + dir;
  if (index < 0 || j < 0 || j >= items.length) return null;
  const me = items[index]!;
  const next = items[j]!;
  if (me.supersetGroup !== null && next.supersetGroup === me.supersetGroup) return swap(items, index, j);
  const free: DraftItem = me.supersetGroup === null ? me : { ...me, supersetGroup: null };
  if (next.supersetGroup === null) {
    const out = swap(items, index, j);
    out[j] = free;
    return out;
  }
  const [start, end] = runBounds(items, j);
  const rest = items.filter((_, k) => k !== index);
  rest.splice(dir === -1 ? start : end, 0, free);
  return rest;
}

const withItems = (state: Draft, items: readonly DraftItem[]): Draft => ({ ...state, items: settle(items), dirty: true });

export function reduce(state: Draft, action: DraftAction): Draft {
  switch (action.type) {
    case "rename":
      return action.name === state.name ? state : { ...state, name: action.name, dirty: true };
    case "setNotes":
      return action.notes === state.notes ? state : { ...state, notes: action.notes, dirty: true };
    case "add": {
      if (state.items.length >= ROUTINE_ITEMS_MAX) return state;
      const item: DraftItem = {
        key: action.key,
        exerciseId: action.exerciseId,
        targetSets: null,
        targetRepsLow: null,
        targetRepsHigh: null,
        targetRpe: null,
        restSeconds: null,
        notes: null,
        supersetGroup: null,
      };
      return withItems(state, [...state.items, item]);
    }
    case "remove":
      return state.items.some((i) => i.key === action.key)
        ? withItems(state, state.items.filter((i) => i.key !== action.key))
        : state;
    case "moveUp":
    case "moveDown": {
      const index = state.items.findIndex((i) => i.key === action.key);
      const out = move(state.items, index, action.type === "moveUp" ? -1 : 1);
      return out ? withItems(state, out) : state;
    }
    case "setTargets": {
      const index = state.items.findIndex((i) => i.key === action.key);
      if (index < 0) return state;
      const items = state.items.map((item, k) => (k === index ? { ...item, ...action.targets, notes: action.notes } : item));
      return withItems(state, items);
    }
    case "toggleLink": {
      const out = toggleLink(state, action.index);
      return out ? withItems(state, out) : state;
    }
    case "markRetired": {
      const keys = new Set(action.keys);
      if (!state.items.some((i) => keys.has(i.key))) return state;
      return { ...state, items: state.items.map((i) => (keys.has(i.key) ? { ...i, retired: true as const } : i)) };
    }
    case "dismissAdjusted":
      return state.adjusted ? { ...state, adjusted: false } : state;
    case "load": {
      const raw: DraftItem[] = [...action.routine.items]
        .sort((a, b) => a.position - b.position)
        .map((item, k) => ({
          key: action.keys[k] ?? newKey(),
          exerciseId: item.exerciseId,
          targetSets: item.targetSets,
          targetRepsLow: item.targetRepsLow,
          targetRepsHigh: item.targetRepsHigh,
          targetRpe: item.targetRpe,
          restSeconds: item.restSeconds,
          notes: item.notes,
          supersetGroup: item.supersetGroup,
        }));
      const items = settle(raw);
      const adjusted = items.some((item, k) => item.supersetGroup !== raw[k]!.supersetGroup);
      return { name: action.routine.name, notes: action.routine.notes ?? "", items, dirty: adjusted, adjusted };
    }
  }
}

/** Where row `index` sits in its bracket. A group of one draws no bracket (Spec 09 D10). */
export function runPosition(groups: readonly (number | null)[], index: number): "none" | "first" | "middle" | "last" {
  const g = groups[index];
  if (g === null || g === undefined) return "none";
  const prev = index > 0 && groups[index - 1] === g;
  const next = groups[index + 1] === g;
  if (prev && next) return "middle";
  if (next) return "first";
  if (prev) return "last";
  return "none";
}
