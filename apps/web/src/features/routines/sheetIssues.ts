import type { RowErrors } from "./planRows";
import type { DraftIssue, ItemField } from "./validateDraft";

export type SheetField = "sets" | "reps" | "weight" | "rest" | "notes";
export type SheetMessages = Partial<Record<SheetField, string>>;

const SHEET_FIELD: Partial<Record<ItemField, SheetField>> = {
  targetSets: "sets",
  targetRepsLow: "reps",
  targetRepsHigh: "reps",
  weight: "weight",
  restSeconds: "rest",
  notes: "notes",
};

/** The item-scope issues that have an input on the sheet; the first message per input wins. */
export function fieldMessagesFor(issues: readonly DraftIssue[], itemKey: string): SheetMessages {
  const out: SheetMessages = {};
  for (const issue of issues) {
    if (issue.scope !== "item" || issue.itemKey !== itemKey) continue;
    const field = SHEET_FIELD[issue.field];
    if (field !== undefined && out[field] === undefined) out[field] = issue.message;
  }
  return out;
}

export function rowMessagesFor(issues: readonly DraftIssue[], itemKey: string): ReadonlyMap<string, RowErrors> {
  const out = new Map<string, RowErrors>();
  for (const issue of issues) {
    if (issue.scope !== "row" || issue.itemKey !== itemKey) continue;
    const entry = out.get(issue.rowKey) ?? {};
    if (entry[issue.field] === undefined) entry[issue.field] = issue.message;
    out.set(issue.rowKey, entry);
  }
  return out;
}

/** What the editor row shows under an item: the first problem on it, row-level ones included. */
export function itemMessage(issues: readonly DraftIssue[], itemKey: string): string | null {
  const found = issues.find((i) => (i.scope === "item" || i.scope === "row") && i.itemKey === itemKey);
  return found ? found.message : null;
}

/** The section-scope messages for one section's sheet, first per field. */
export function sectionMessagesFor(issues: readonly DraftIssue[], sectionKey: string): { name?: string; notes?: string } {
  const out: { name?: string; notes?: string } = {};
  for (const issue of issues) {
    if (issue.scope !== "section" || issue.sectionKey !== sectionKey) continue;
    if (out[issue.field] === undefined) out[issue.field] = issue.message;
  }
  return out;
}

/** What the editor shows under a section header: the first problem on it. */
export function sectionError(issues: readonly DraftIssue[], sectionKey: string): string | null {
  const found = issues.find((i) => i.scope === "section" && i.sectionKey === sectionKey);
  return found ? found.message : null;
}
