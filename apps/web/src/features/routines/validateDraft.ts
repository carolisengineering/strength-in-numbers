import {
  expandQuickLine,
  forbiddenMeasuresFor,
  plannedSetViolations,
  ROUTINE_ITEM_NOTES_MAX,
  ROUTINE_NAME_MAX,
  ROUTINE_NOTES_MAX,
  RoutineWriteSchema,
  type Modality,
  type Routine,
  type WeightUnit,
} from "@sin/core";
import type { z } from "zod";
import type { ExerciseState } from "./exerciseLookup";
import type { Draft, DraftItem, DraftSet } from "./routineDraft";
import { SECTION_NAME_INVALID, SECTION_NOTES_INVALID } from "./messages";
import { parseSectionName, parseSectionNotes } from "./sectionText";
import { WEIGHT_MESSAGE } from "./targetFormat";

/** The POST/PUT body (Spec 09 §5) before Zod's transforms. */
export type RoutineWriteInput = z.input<typeof RoutineWriteSchema>;

export type ItemField =
  | "exerciseId"
  | "targetSets"
  | "targetRepsLow"
  | "targetRepsHigh"
  | "targetRpe"
  | "restSeconds"
  | "supersetGroup"
  | "notes"
  | "weight";

export type DraftIssue =
  | { readonly scope: "name" | "notes" | "items" | "form"; readonly message: string }
  | { readonly scope: "item"; readonly itemKey: string; readonly field: ItemField; readonly message: string }
  | { readonly scope: "section"; readonly sectionKey: string; readonly field: "name" | "notes"; readonly message: string }
  | { readonly scope: "row"; readonly itemKey: string; readonly rowKey: string; readonly field: "reps" | "weight"; readonly message: string };

export interface DraftValidation {
  readonly ok: boolean;
  readonly issues: readonly DraftIssue[];
  /** A superset-size, section-span or section-order issue reached Zod — impossible if the reducer is right (AC4); the editor reports it. */
  readonly groupBug: boolean;
}

export const NAME_REQUIRED = "Give the routine a name";
export const NAME_TOO_LONG = `Keep the name to ${ROUTINE_NAME_MAX} characters or fewer`;
export const NAME_INVALID = "Remove unusual characters from the name";
export const NOTES_INVALID = `Keep notes to ${ROUTINE_NOTES_MAX} characters, without unusual characters`;
export const ITEMS_REQUIRED = "Add at least one exercise";
export const UNAVAILABLE = "No longer available — remove or replace";
export const NAME_TAKEN = "You already have a routine with this name";
export const GROUP_BUG = "Something went wrong with the supersets — unlink and relink them";
export const FORM_INVALID = "Something in this routine can't be saved — check it and try again";
export const WEIGHT_NEEDS_SETS = "Enter the number of sets to plan a weight";

const ITEM_MESSAGES: Record<ItemField, string> = {
  exerciseId: "This exercise can't be used — remove or replace it",
  targetSets: "Check the sets — a whole number from 1 to 20",
  targetRepsLow: "Check the reps — the low number can't be more than the high one",
  targetRepsHigh: "Check the reps",
  targetRpe: "Pick an RPE from the list",
  restSeconds: "Check the rest — up to 15:00",
  supersetGroup: GROUP_BUG,
  notes: `Keep notes to ${ROUTINE_ITEM_NOTES_MAX} characters, without unusual characters`,
  weight: WEIGHT_MESSAGE,
};

const ROW_MESSAGES = { reps: "Check the reps — like 8 or 8-10, low number first", weight: WEIGHT_MESSAGE } as const;

const ITEM_FIELDS = new Set<string>(Object.keys(ITEM_MESSAGES));

export type ModalityOf = (exerciseId: string) => Modality | null;

/** What the exercise's modality can carry (D6). An unknown modality (catalog not synced) omits nothing. */
function carries(modality: Modality | null): { reps: boolean; weight: boolean } {
  const forbidden = modality === null ? [] : forbiddenMeasuresFor(modality);
  return { reps: !forbidden.includes("reps"), weight: !forbidden.includes("weight") };
}

function itemInput(item: DraftItem, modality: Modality | null) {
  const can = carries(modality);
  const itemNotes = item.notes?.trim() ?? "";
  const common = {
    exerciseId: item.exerciseId,
    targetRpe: item.targetRpe,
    restSeconds: item.restSeconds,
    supersetGroup: item.supersetGroup,
    ...(itemNotes === "" ? {} : { notes: itemNotes }),
  };
  const rowBody = (setType: DraftSet["setType"], low: number | null, high: number | null, weight: number | null, unit: WeightUnit | null) => ({
    setType,
    ...(can.reps && low !== null && high !== null ? { repsLow: low, repsHigh: high } : {}),
    ...(can.weight && weight !== null && unit !== null ? { weight, weightUnit: unit } : {}),
  });
  if (item.plan !== null) {
    return { ...common, sets: item.plan.map((r) => rowBody(r.setType, r.repsLow, r.repsHigh, r.weight, r.weightUnit)) };
  }
  if (item.targetSets !== null) {
    const rows = expandQuickLine({
      targetSets: item.targetSets,
      targetRepsLow: can.reps ? item.targetRepsLow : null,
      targetRepsHigh: can.reps ? item.targetRepsHigh : null,
    });
    return { ...common, sets: rows.map((r) => rowBody(r.setType, r.repsLow, r.repsHigh, item.weight, item.weightUnit)) };
  }
  // No set count: the legacy reps keys only (Spec 09.1 O1). A weight cannot be sent without rows; validateDraft flags it.
  return {
    ...common,
    targetRepsLow: can.reps ? item.targetRepsLow : null,
    targetRepsHigh: can.reps ? item.targetRepsHigh : null,
  };
}

/** The body the editor sends (AC6): exactly one form per item. Array order is position; keys and server ids never leave. */
export function toRoutineInput(draft: Draft, options: { modalityOf: ModalityOf }): RoutineWriteInput {
  const notes = draft.notes.trim();
  // Request-local keys, minted from section order: the draft's own keys never leave (AC7).
  const requestKey = new Map(draft.sections.map((s, j) => [s.key, `s${j + 1}`]));
  const sections = draft.sections.map((s) => {
    const sectionNotes = s.notes.trim();
    return { key: requestKey.get(s.key)!, name: s.name.trim(), ...(sectionNotes === "" ? {} : { notes: sectionNotes }) };
  });
  return {
    name: draft.name.trim(),
    ...(notes === "" ? {} : { notes }),
    ...(sections.length === 0 ? {} : { sections }),
    items: draft.items.map((item) => {
      const sectionKey = item.sectionKey === null ? undefined : requestKey.get(item.sectionKey);
      return { ...itemInput(item, options.modalityOf(item.exerciseId)), ...(sectionKey === undefined ? {} : { sectionKey }) };
    }),
  };
}

/** `"items.3.targetSets"` → `["items", 3, "targetSets"]` — the API's `errors[].path` form (Spec 09 §5). */
export function splitPath(path: string): PropertyKey[] {
  return path.split(".").map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** One Zod / API path → where the editor shows it; `null` when it names nothing on screen. */
export function issueForPath(
  path: readonly PropertyKey[],
  keys: readonly string[],
  planKeys: PlanKeys = [],
  sectionKeys: readonly string[] = [],
): DraftIssue | null {
  const [head, index, field, rowIndex, rowField] = path;
  if (head === "name") return { scope: "name", message: NAME_INVALID };
  if (head === "notes") return { scope: "notes", message: NOTES_INVALID };
  if (head === "items" && path.length === 1) return { scope: "items", message: ITEMS_REQUIRED };
  if (head === "sections") {
    const sectionKey = typeof index === "number" ? sectionKeys[index] : undefined;
    if (sectionKey === undefined || path.length !== 3) return null;
    if (field === "name") return { scope: "section", sectionKey, field: "name", message: SECTION_NAME_INVALID };
    if (field === "notes") return { scope: "section", sectionKey, field: "notes", message: SECTION_NOTES_INVALID };
    return null;
  }
  if (head !== "items" || typeof index !== "number") return null;
  const itemKey = keys[index];
  if (itemKey === undefined) return null;
  const item = (f: ItemField): DraftIssue => ({ scope: "item", itemKey, field: f, message: ITEM_MESSAGES[f] });
  if (field === "sets") {
    if (path.length === 3) return item("targetSets"); // too many rows, or the two forms together
    if (typeof rowIndex !== "number" || typeof rowField !== "string") return null;
    const rowKeys = planKeys[index] ?? null;
    if (rowKeys === null) {
      if (rowField === "repsLow") return item("targetRepsLow");
      if (rowField === "repsHigh") return item("targetRepsHigh");
      if (rowField === "weight" || rowField === "weightUnit") return item("weight");
      return null;
    }
    const rowKey = rowKeys[rowIndex];
    if (rowKey === undefined) return null;
    if (rowField === "repsLow" || rowField === "repsHigh") return { scope: "row", itemKey, rowKey, field: "reps", message: ROW_MESSAGES.reps };
    if (rowField === "weight" || rowField === "weightUnit") return { scope: "row", itemKey, rowKey, field: "weight", message: ROW_MESSAGES.weight };
    return null;
  }
  // A superset or section-order path names nothing the lifter can edit on screen (the reducer cannot build it): form-level.
  if (field === "supersetGroup" || field === "sectionKey") return null;
  if (typeof field === "string" && ITEM_FIELDS.has(field) && path.length === 3) return item(field as ItemField);
  return null;
}

/** Plan-mode row keys per item (`null` for a quick-mode item), so a `sets.<j>` path can find its row. */
export type PlanKeys = readonly (readonly string[] | null)[];

const issueId = (issue: DraftIssue): string =>
  issue.scope === "item" ? `item:${issue.itemKey}:${issue.field}` : issue.scope === "section" ? `section:${issue.sectionKey}:${issue.field}` : issue.scope === "row" ? `row:${issue.rowKey}:${issue.field}` : issue.scope;

/** The same function the API runs (Spec 09.1 AC23) over the rows this body carries; maps to the sheet's places. */
export function plannedViolationIssues(draft: Draft, body: RoutineWriteInput, modalityOf: ModalityOf): DraftIssue[] {
  const out: DraftIssue[] = [];
  draft.items.forEach((item, i) => {
    const sets = body.items[i]?.sets;
    const modality = modalityOf(item.exerciseId);
    if (sets === undefined || modality === null) return;
    for (const v of plannedSetViolations(modality, sets)) {
      const field = v.field === "weight" || v.field === "weightUnit" ? "weight" : "reps";
      const planRow = item.plan?.[v.row];
      out.push(
        planRow
          ? { scope: "row", itemKey: item.key, rowKey: planRow.key, field, message: ROW_MESSAGES[field] }
          : { scope: "item", itemKey: item.key, field: field === "weight" ? "weight" : "targetRepsLow", message: ITEM_MESSAGES[field === "weight" ? "weight" : "targetRepsLow"] },
      );
    }
  });
  return out;
}

/**
 * AC7. Client-owned checks run first (name, empty list, retired rows) so the lifter sees the actionable
 * message; then the shared write schema catches everything else, in the app's wording.
 */
export function validateDraft(
  draft: Draft,
  options: { exerciseState: (exerciseId: string) => ExerciseState; modalityOf?: ModalityOf },
): DraftValidation {
  const modalityOf = options.modalityOf ?? (() => null);
  const issues: DraftIssue[] = [];
  const seen = new Set<string>();
  const push = (issue: DraftIssue) => {
    const id = issueId(issue);
    if (seen.has(id)) return;
    seen.add(id);
    issues.push(issue);
  };

  const name = draft.name.trim();
  if (name === "") push({ scope: "name", message: NAME_REQUIRED });
  // Code points, as Zod 4's `.max()` counts them — so the editor and the server agree on emoji.
  else if (Array.from(name).length > ROUTINE_NAME_MAX) push({ scope: "name", message: NAME_TOO_LONG });
  if (draft.items.length === 0) push({ scope: "items", message: ITEMS_REQUIRED });
  for (const item of draft.items) {
    if (item.retired || options.exerciseState(item.exerciseId) === "retired") {
      push({ scope: "item", itemKey: item.key, field: "exerciseId", message: UNAVAILABLE });
    }
  }

  for (const item of draft.items) {
    if (item.plan === null && item.weight !== null && item.targetSets === null && carries(modalityOf(item.exerciseId)).weight) {
      push({ scope: "item", itemKey: item.key, field: "weight", message: WEIGHT_NEEDS_SETS });
    }
  }

  for (const section of draft.sections) {
    const nameParsed = parseSectionName(section.name);
    if (!nameParsed.ok) push({ scope: "section", sectionKey: section.key, field: "name", message: nameParsed.message });
    const notesParsed = parseSectionNotes(section.notes);
    if (!notesParsed.ok) push({ scope: "section", sectionKey: section.key, field: "notes", message: notesParsed.message });
  }

  let groupBug = false;
  const body = toRoutineInput(draft, { modalityOf });
  const parsed = RoutineWriteSchema.safeParse(body);
  if (!parsed.success) {
    const keys = draft.items.map((i) => i.key);
    const planKeys: PlanKeys = draft.items.map((i) => (i.plan === null ? null : i.plan.map((r) => r.key)));
    for (const zodIssue of parsed.error.issues) {
      if (zodIssue.path[0] === "items" && (zodIssue.path[2] === "supersetGroup" || zodIssue.path[2] === "sectionKey")) {
        groupBug = true;
        push({ scope: "form", message: zodIssue.path[2] === "sectionKey" ? FORM_INVALID : GROUP_BUG });
        continue;
      }
      push(issueForPath(zodIssue.path, keys, planKeys, draft.sections.map((s) => s.key)) ?? { scope: "form", message: FORM_INVALID });
    }
  }
  for (const issue of plannedViolationIssues(draft, body, modalityOf)) push(issue);
  return { ok: issues.length === 0, issues, groupBug };
}

/** AC8 — a non-blocking warning; the server's `409 routine-name-taken` is authoritative. */
export function nameTaken(name: string, routines: readonly Routine[], selfId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return false;
  return routines.some((r) => r.id !== selfId && r.name.trim().toLowerCase() === wanted);
}
