import {
  canLinkRule,
  deriveTargets,
  isLinked as isLinkedRule,
  isUniformWorking,
  linkRule,
  moveRule,
  normalizeSupersetGroups,
  PLANNED_SETS_PER_ITEM_MAX,
  ROUTINE_ITEMS_MAX,
  ROUTINE_SECTIONS_MAX,
  unlinkRule,
  type Routine,
  type SessionSlot,
  type SetType,
  type WeightUnit,
} from "@sin/core";
import type { Targets, WeightedRow } from "./targetFormat";

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

export interface DraftSection {
  readonly key: string;
  readonly name: string;
  /** "" = no note (like `Draft.notes`); trimmed and omitted when blank by `toRoutineInput`. */
  readonly notes: string;
}

/** The text on a link toggle the lifter can never see: supersets do not cross a section boundary (Spec 10.3 AC5). */
export const SECTION_LINK_REFUSAL = "Supersets stay inside one section";

export interface DraftItem extends Targets {
  readonly key: string;
  readonly exerciseId: string;
  readonly notes: string | null;
  readonly supersetGroup: number | null;
  /** The `key` of the section this item sits in; `null` = loose. Client-only, never sent (the request uses `s1…`, AC7). */
  readonly sectionKey: string | null;
  /** Quick mode (`plan === null`): the weight typed on the quick line; a unit only ever travels with a weight. */
  readonly weight: number | null;
  readonly weightUnit: WeightUnit | null;
  /** Plan mode: one row per set (1–20). In plan mode `targetSets` / reps are derived from the rows. */
  readonly plan: readonly DraftSet[] | null;
  /** Set when the server answered `409 exercise-retired` for this row (AC33). */
  readonly retired?: true;
}

/** One planned set while the item is in plan mode (Spec 10.2 AC4). `key` is client-only and never sent. */
export interface DraftSet {
  readonly key: string;
  readonly setType: SetType;
  readonly repsLow: number | null;
  readonly repsHigh: number | null;
  readonly weight: number | null;
  readonly weightUnit: WeightUnit | null;
}

/** What the item sheet commits on Done (the sheet keeps its own local state until then, P1). */
export type PlannedEdit =
  | { readonly mode: "quick"; readonly weight: number | null; readonly weightUnit: WeightUnit | null }
  | { readonly mode: "rows"; readonly rows: readonly DraftSet[] };

export interface Draft {
  readonly name: string;
  readonly notes: string;
  readonly sections: readonly DraftSection[];
  readonly items: readonly DraftItem[];
  readonly dirty: boolean;
  /** `load` had to split a non-contiguous group (AC5); the editor shows a notice until dismissed. */
  readonly adjusted: boolean;
  /** Spec 10.3 AC5: a link was refused or dissolved at a section boundary; the editor shows a notice until dismissed. */
  readonly unlinkNotice: boolean;
}

export type DraftAction =
  | { readonly type: "rename"; readonly name: string }
  | { readonly type: "setNotes"; readonly notes: string }
  | { readonly type: "add"; readonly exerciseId: string; readonly key: string }
  | { readonly type: "remove"; readonly key: string }
  | { readonly type: "moveUp"; readonly key: string }
  | { readonly type: "moveDown"; readonly key: string }
  | { readonly type: "setTargets"; readonly key: string; readonly targets: Targets; readonly notes: string | null }
  | { readonly type: "setPlanned"; readonly key: string; readonly planned: PlannedEdit }
  | { readonly type: "toggleLink"; readonly index: number }
  | { readonly type: "addSection"; readonly name: string; readonly key: string }
  | { readonly type: "renameSection"; readonly key: string; readonly name: string }
  | { readonly type: "setSectionNotes"; readonly key: string; readonly notes: string }
  | { readonly type: "moveSectionUp"; readonly key: string }
  | { readonly type: "moveSectionDown"; readonly key: string }
  | { readonly type: "deleteSection"; readonly key: string }
  | { readonly type: "dismissUnlinkNotice" }
  | {
      readonly type: "load";
      readonly routine: Routine;
      readonly keys: readonly string[];
      readonly rowKeys: readonly (readonly string[])[];
      readonly sectionKeys: readonly string[];
    }
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
  setPlanned: (key: string, planned: PlannedEdit): DraftAction => ({ type: "setPlanned", key, planned }),
  toggleLink: (index: number): DraftAction => ({ type: "toggleLink", index }),
  addSection: (name: string): DraftAction => ({ type: "addSection", name, key: newKey() }),
  renameSection: (key: string, name: string): DraftAction => ({ type: "renameSection", key, name }),
  setSectionNotes: (key: string, notes: string): DraftAction => ({ type: "setSectionNotes", key, notes }),
  moveSectionUp: (key: string): DraftAction => ({ type: "moveSectionUp", key }),
  moveSectionDown: (key: string): DraftAction => ({ type: "moveSectionDown", key }),
  deleteSection: (key: string): DraftAction => ({ type: "deleteSection", key }),
  dismissUnlinkNotice: (): DraftAction => ({ type: "dismissUnlinkNotice" }),
  load: (routine: Routine): DraftAction => ({
    type: "load",
    routine,
    keys: routine.items.map(() => newKey()),
    rowKeys: routine.items.map((item) => item.sets.map(() => newKey())),
    sectionKeys: routine.sections.map(() => newKey()),
  }),
  markRetired: (keys: readonly string[]): DraftAction => ({ type: "markRetired", keys }),
  dismissAdjusted: (): DraftAction => ({ type: "dismissAdjusted" }),
};

export function initialDraft(): Draft {
  return { name: "", notes: "", sections: [], items: [], dirty: false, adjusted: false, unlinkNotice: false };
}

export function draftFromRoutine(routine: Routine): Draft {
  return reduce(initialDraft(), actions.load(routine));
}

/**
 * (a) Canonical order: loose items first, then each section's items in the sections' order, relative order
 * kept; an item naming a section that does not exist reads as loose. (b) A superset is one contiguous run of
 * 2–8 inside ONE section: a run that crosses a section boundary is split there, runs of one become ungrouped.
 * (c) Groups are numbered 1, 2, 3 … by first appearance. Spec 10.3 AC6 — the one place these rules live (D1).
 */
function settle(items: readonly DraftItem[], sections: readonly DraftSection[]): DraftItem[] {
  const order = new Map(sections.map((s, i) => [s.key, i]));
  const placed = items.map((item) => (item.sectionKey !== null && !order.has(item.sectionKey) ? { ...item, sectionKey: null } : item));
  const rank = (item: DraftItem): number => (item.sectionKey === null ? -1 : order.get(item.sectionKey)!);
  const sorted = placed
    .map((item, i) => ({ item, i }))
    .sort((a, b) => rank(a.item) - rank(b.item) || a.i - b.i)
    .map((x) => x.item);
  const labels: (number | null)[] = [];
  let label = 0;
  sorted.forEach((item, i) => {
    const g = item.supersetGroup;
    if (g === null) {
      labels.push(null);
      return;
    }
    const prev = sorted[i - 1];
    if (!prev || prev.supersetGroup !== g || prev.sectionKey !== item.sectionKey) label += 1;
    labels.push(label);
  });
  const sizes = new Map<number, number>();
  for (const l of labels) if (l !== null) sizes.set(l, (sizes.get(l) ?? 0) + 1);
  const dense = normalizeSupersetGroups(labels.map((l) => (l !== null && sizes.get(l) === 1 ? null : l)));
  return sorted.map((item, i) => (item.supersetGroup === dense[i] ? item : { ...item, supersetGroup: dense[i]! }));
}

const slotsOf = (items: readonly DraftItem[]): SessionSlot[] => items.map((i) => ({ id: i.key, group: i.supersetGroup }));

/** The rows an item's target line and accessible name are built from (Spec 10.2 AC15). */
export function plannedRowsOf(item: DraftItem): readonly WeightedRow[] {
  if (item.plan !== null) return item.plan;
  return item.weight === null ? [] : [{ weight: item.weight, weightUnit: item.weightUnit }];
}

const sameRows = (a: readonly DraftSet[], b: readonly DraftSet[]): boolean =>
  a.length === b.length &&
  a.every((r, i) => {
    const o = b[i]!;
    return (
      r.key === o.key &&
      r.setType === o.setType &&
      r.repsLow === o.repsLow &&
      r.repsHigh === o.repsHigh &&
      r.weight === o.weight &&
      r.weightUnit === o.weightUnit
    );
  });

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

const withItems = (state: Draft, items: readonly DraftItem[]): Draft => ({ ...state, items: settle(items, state.sections), dirty: true });

const withSections = (state: Draft, sections: readonly DraftSection[], items: readonly DraftItem[]): Draft => ({
  ...state,
  sections,
  items: settle(items, sections),
  dirty: true,
});

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
        weight: null,
        weightUnit: null,
        plan: null,
        sectionKey: null,
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
    case "setPlanned": {
      const index = state.items.findIndex((i) => i.key === action.key);
      if (index < 0) return state;
      const current = state.items[index]!;
      const planned = action.planned;
      let next: DraftItem;
      if (planned.mode === "quick") {
        const unit = planned.weight === null ? null : planned.weightUnit;
        if (current.plan === null && current.weight === planned.weight && current.weightUnit === unit) return state;
        next = { ...current, plan: null, weight: planned.weight, weightUnit: unit };
      } else {
        // Never zero rows (D11) and never more than 20: the sheet cannot produce either, but the reducer is the last line.
        if (planned.rows.length < 1 || planned.rows.length > PLANNED_SETS_PER_ITEM_MAX) return state;
        if (current.plan !== null && sameRows(current.plan, planned.rows)) return state;
        next = { ...current, ...deriveTargets(planned.rows), weight: null, weightUnit: null, plan: planned.rows };
      }
      return withItems(state, state.items.map((item, k) => (k === index ? next : item)));
    }
    case "toggleLink": {
      const out = toggleLink(state, action.index);
      return out ? withItems(state, out) : state;
    }
    case "addSection": {
      const name = action.name.trim();
      if (name === "" || state.sections.length >= ROUTINE_SECTIONS_MAX) return state;
      return { ...state, sections: [...state.sections, { key: action.key, name, notes: "" }], dirty: true };
    }
    case "renameSection": {
      const name = action.name.trim();
      const section = state.sections.find((s) => s.key === action.key);
      if (!section || name === "" || section.name === name) return state;
      return { ...state, sections: state.sections.map((s) => (s.key === action.key ? { ...s, name } : s)), dirty: true };
    }
    case "setSectionNotes": {
      const section = state.sections.find((s) => s.key === action.key);
      if (!section || section.notes === action.notes) return state;
      return { ...state, sections: state.sections.map((s) => (s.key === action.key ? { ...s, notes: action.notes } : s)), dirty: true };
    }
    case "moveSectionUp":
    case "moveSectionDown": {
      const i = state.sections.findIndex((s) => s.key === action.key);
      const j = action.type === "moveSectionUp" ? i - 1 : i + 1;
      if (i < 0 || j < 0 || j >= state.sections.length) return state;
      const sections = [...state.sections];
      [sections[i], sections[j]] = [sections[j]!, sections[i]!];
      return withSections(state, sections, state.items);
    }
    case "deleteSection": {
      if (!state.sections.some((s) => s.key === action.key)) return state;
      const items = state.items.map((i) => (i.sectionKey === action.key ? { ...i, sectionKey: null } : i));
      return withSections(state, state.sections.filter((s) => s.key !== action.key), items);
    }
    case "dismissUnlinkNotice":
      return state.unlinkNotice ? { ...state, unlinkNotice: false } : state;
    case "markRetired": {
      const keys = new Set(action.keys);
      if (!state.items.some((i) => keys.has(i.key))) return state;
      return { ...state, items: state.items.map((i) => (keys.has(i.key) ? { ...i, retired: true as const } : i)) };
    }
    case "dismissAdjusted":
      return state.adjusted ? { ...state, adjusted: false } : state;
    case "load": {
      const sortedSections = [...action.routine.sections].sort((a, b) => a.position - b.position);
      const sections: DraftSection[] = sortedSections.map((s, j) => ({ key: action.sectionKeys[j] ?? newKey(), name: s.name, notes: s.notes ?? "" }));
      const keyById = new Map(sortedSections.map((s, j) => [s.id as string, sections[j]!.key]));
      const raw: DraftItem[] = [...action.routine.items]
        .sort((a, b) => a.position - b.position)
        .map((item, k): DraftItem => {
          const base = {
            key: action.keys[k] ?? newKey(),
            exerciseId: item.exerciseId,
            targetRpe: item.targetRpe,
            restSeconds: item.restSeconds,
            notes: item.notes,
            supersetGroup: item.supersetGroup,
            sectionKey: item.sectionId === null ? null : (keyById.get(item.sectionId) ?? null),
          };
          const rows = item.sets;
          if (rows.length === 0) {
            // No rows: the item's own columns (a reps-only item keeps its range, Spec 09.1 O1).
            return { ...base, targetSets: item.targetSets, targetRepsLow: item.targetRepsLow, targetRepsHigh: item.targetRepsHigh, weight: null, weightUnit: null, plan: null };
          }
          if (isUniformWorking(rows)) {
            const first = rows[0]!;
            return { ...base, targetSets: rows.length, targetRepsLow: first.repsLow, targetRepsHigh: first.repsHigh, weight: first.weight, weightUnit: first.weightUnit, plan: null };
          }
          const plan: DraftSet[] = rows.map((r, j) => ({ key: action.rowKeys[k]?.[j] ?? newKey(), ...r }));
          return { ...base, ...deriveTargets(rows), weight: null, weightUnit: null, plan };
        });
      const items = settle(raw, sections);
      const adjusted = items.some(
        (item, k) => item.key !== raw[k]!.key || item.supersetGroup !== raw[k]!.supersetGroup || item.sectionKey !== raw[k]!.sectionKey,
      );
      return { name: action.routine.name, notes: action.routine.notes ?? "", sections, items, dirty: adjusted, adjusted, unlinkNotice: false };
    }
  }
}
