import { deriveTargets, type ImportPlan } from "@sin/core";

import type { Draft, DraftItem, DraftSection } from "../routineDraft";

/**
 * Spec 10.4 AC29, §6.5, pure: an import plan as an ordinary editor draft. Fresh keys everywhere; `idOf`
 * gives each name its exercise id (a real one, or a New card's placeholder, shared by every item with
 * that name). Weights, RPE and rest stay empty; the draft starts dirty so the leave guard is armed.
 */
export function draftFromImport(plan: ImportPlan, idOf: (nameKey: string) => string): Draft {
  const sections: DraftSection[] = plan.sections.map((section) => ({ key: crypto.randomUUID(), name: section.name, notes: section.notes ?? "" }));
  const items: DraftItem[] = plan.items.map((item) => {
    const base = {
      key: crypto.randomUUID(),
      exerciseId: idOf(item.nameKey),
      notes: item.notes,
      supersetGroup: item.supersetGroup,
      sectionKey: item.section === null ? null : sections[item.section]!.key,
      targetRpe: null,
      restSeconds: null,
      weight: null,
      weightUnit: null,
    };
    if (item.form.kind === "quick") {
      const { targetSets, targetRepsLow, targetRepsHigh } = item.form;
      return { ...base, targetSets, targetRepsLow, targetRepsHigh, plan: null };
    }
    const rows = item.form.rows.map((row) => ({
      key: crypto.randomUUID(),
      setType: "working" as const,
      repsLow: row.repsLow,
      repsHigh: row.repsHigh,
      weight: null,
      weightUnit: null,
    }));
    return { ...base, ...deriveTargets(rows), plan: rows };
  });
  return { name: plan.name, notes: plan.notes ?? "", sections, items, dirty: true, adjusted: false, unlinkNotice: false };
}
