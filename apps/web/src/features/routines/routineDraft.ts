import {
  canLinkRule,
  isLinked as isLinkedRule,
  linkRule,
  moveRule,
  normalizeSupersetGroups,
  ROUTINE_ITEMS_MAX,
  unlinkRule,
  type Routine,
  type SessionSlot,
} from "@sin/core";
import type { Targets } from "./targetFormat";

/**
 * The routine editor's draft (Spec 10.0 §6.2, AC1–AC5). Pure — no React. Private to the editor: `key`s
 * are client-only and never reach the server, and server item ids are discarded on load (they are not
 * stable across a PUT, Spec 09 AC13).
 *
 * Invariant after every action: each non-null `supersetGroup` is one contiguous run of 2–8 items,
 * numbered 1, 2, 3 … by first appearance — exactly what the server will store. `settle` enforces it
 * once, at the end of every changing branch, so no single action can forget a rule (D8).
 *
 * Spec 10.1: the link / split / block-move rules are `@sin/core` `supersets.ts`; this module keeps `settle` on top.
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

/** Spec 10.1 AC5: the link / unlink / block-move rules and `runPosition` live in `@sin/core` `supersets.ts`. */
export { LINK_CAP_MESSAGE, runPosition } from "@sin/core";

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

const slotsOf = (items: readonly DraftItem[]): SessionSlot[] => items.map((i) => ({ id: i.key, group: i.supersetGroup }));

/** Map a core rule result (slot ids are item keys) back onto the items; `settle` renumbers afterwards. */
function fromSlots(items: readonly DraftItem[], slots: readonly SessionSlot[]): DraftItem[] {
  const byKey = new Map(items.map((i) => [i.key, i]));
  return slots.map((s) => {
    const item = byKey.get(s.id)!;
    return item.supersetGroup === s.group ? item : { ...item, supersetGroup: s.group };
  });
}

export function isLinked(items: readonly DraftItem[], index: number): boolean {
  return isLinkedRule(slotsOf(items), index);
}

export function canLink(state: Draft, index: number): { ok: true } | { ok: false; reason: string } {
  return canLinkRule(slotsOf(state.items), index);
}

function toggleLink(state: Draft, index: number): DraftItem[] | null {
  const { items } = state;
  if (index < 0 || index >= items.length - 1) return null;
  const slots = slotsOf(items);
  if (isLinkedRule(slots, index)) return fromSlots(items, unlinkRule(slots, index));
  const linked = linkRule(slots, index);
  return linked.ok ? fromSlots(items, linked.slots) : null;
}

/** Block moves (D8): see `moveRule`. */
function move(items: readonly DraftItem[], index: number, dir: -1 | 1): DraftItem[] | null {
  const out = moveRule(slotsOf(items), index, dir);
  return out ? fromSlots(items, out) : null;
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
      const current = state.items[index]!;
      const unchanged =
        current.notes === action.notes &&
        (Object.keys(action.targets) as (keyof Targets)[]).every((k) => current[k] === action.targets[k]);
      if (unchanged) return state; // Done on an untouched sheet must not arm the leave guard (AC1)
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
