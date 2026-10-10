import {
  ROUTINE_ITEM_NOTES_MAX,
  ROUTINE_NAME_MAX,
  ROUTINE_NOTES_MAX,
  RoutineWriteSchema,
  type Routine,
} from "@sin/core";
import type { z } from "zod";
import type { ExerciseState } from "./exerciseLookup";
import type { Draft } from "./routineDraft";

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
  | "notes";

export type DraftIssue =
  | { readonly scope: "name" | "notes" | "items" | "form"; readonly message: string }
  | { readonly scope: "item"; readonly itemKey: string; readonly field: ItemField; readonly message: string };

export interface DraftValidation {
  readonly ok: boolean;
  readonly issues: readonly DraftIssue[];
  /** A superset-size issue reached Zod — impossible if the reducer is right (AC4); the editor reports it. */
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

const ITEM_MESSAGES: Record<ItemField, string> = {
  exerciseId: "This exercise can't be used — remove or replace it",
  targetSets: "Check the sets — a whole number from 1 to 20",
  targetRepsLow: "Check the reps — the low number can't be more than the high one",
  targetRepsHigh: "Check the reps",
  targetRpe: "Pick an RPE from the list",
  restSeconds: "Check the rest — up to 15:00",
  supersetGroup: GROUP_BUG,
  notes: `Keep notes to ${ROUTINE_ITEM_NOTES_MAX} characters, without unusual characters`,
};

const ITEM_FIELDS = new Set<string>(Object.keys(ITEM_MESSAGES));

/** The body the editor sends (AC6). Array order is position; keys and server ids never leave. */
export function toRoutineInput(draft: Draft): RoutineWriteInput {
  const notes = draft.notes.trim();
  return {
    name: draft.name.trim(),
    ...(notes === "" ? {} : { notes }),
    items: draft.items.map((item) => {
      const itemNotes = item.notes?.trim() ?? "";
      return {
        exerciseId: item.exerciseId,
        targetSets: item.targetSets,
        targetRepsLow: item.targetRepsLow,
        targetRepsHigh: item.targetRepsHigh,
        targetRpe: item.targetRpe,
        restSeconds: item.restSeconds,
        supersetGroup: item.supersetGroup,
        ...(itemNotes === "" ? {} : { notes: itemNotes }),
      };
    }),
  };
}

/** `"items.3.targetSets"` → `["items", 3, "targetSets"]` — the API's `errors[].path` form (Spec 09 §5). */
export function splitPath(path: string): PropertyKey[] {
  return path.split(".").map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));
}

/** One Zod / API path → where the editor shows it; `null` when it names nothing on screen. */
export function issueForPath(path: readonly PropertyKey[], keys: readonly string[]): DraftIssue | null {
  const [head, index, field] = path;
  if (head === "name") return { scope: "name", message: NAME_INVALID };
  if (head === "notes") return { scope: "notes", message: NOTES_INVALID };
  if (head === "items" && path.length === 1) return { scope: "items", message: ITEMS_REQUIRED };
  if (head === "items" && typeof index === "number" && typeof field === "string" && ITEM_FIELDS.has(field)) {
    const itemKey = keys[index];
    if (itemKey === undefined) return null;
    const f = field as ItemField;
    return { scope: "item", itemKey, field: f, message: ITEM_MESSAGES[f] };
  }
  return null;
}

const issueId = (issue: DraftIssue): string =>
  issue.scope === "item" ? `item:${issue.itemKey}:${issue.field}` : issue.scope;

/**
 * AC7. Client-owned checks run first (name, empty list, retired rows) so the lifter sees the actionable
 * message; then the shared write schema catches everything else, in the app's wording.
 */
export function validateDraft(
  draft: Draft,
  options: { exerciseState: (exerciseId: string) => ExerciseState },
): DraftValidation {
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

  let groupBug = false;
  const parsed = RoutineWriteSchema.safeParse(toRoutineInput(draft));
  if (!parsed.success) {
    const keys = draft.items.map((i) => i.key);
    for (const zodIssue of parsed.error.issues) {
      if (zodIssue.path[0] === "items" && zodIssue.path[2] === "supersetGroup") {
        groupBug = true;
        push({ scope: "form", message: GROUP_BUG });
        continue;
      }
      push(issueForPath(zodIssue.path, keys) ?? { scope: "form", message: FORM_INVALID });
    }
  }
  return { ok: issues.length === 0, issues, groupBug };
}

/** AC8 — a non-blocking warning; the server's `409 routine-name-taken` is authoritative. */
export function nameTaken(name: string, routines: readonly Routine[], selfId?: string): boolean {
  const wanted = name.trim().toLowerCase();
  if (wanted === "") return false;
  return routines.some((r) => r.id !== selfId && r.name.trim().toLowerCase() === wanted);
}
