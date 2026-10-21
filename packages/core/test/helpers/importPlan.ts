import type { ImportPlan } from "../../src/importPlan.js";

/** Spec 10.4 tests: every item points at one placeholder exercise. */
export const STUB_ID = "00000000-0000-4000-8000-000000000001";

/**
 * Maps an import plan to a `RoutineWrite` body, so tests can check it with `RoutineWriteSchema`.
 * An item-less plan gets one loose stub item first, so it still parses and loose-first holds.
 */
export function toWrite(plan: ImportPlan): Record<string, unknown> {
  const items = plan.items.map((it) => ({
    exerciseId: STUB_ID,
    ...(it.section === null ? {} : { sectionKey: `s${it.section + 1}` }),
    ...(it.supersetGroup === null ? {} : { supersetGroup: it.supersetGroup }),
    ...(it.notes === null ? {} : { notes: it.notes }),
    ...(it.form.kind === "quick"
      ? { targetSets: it.form.targetSets, targetRepsLow: it.form.targetRepsLow, targetRepsHigh: it.form.targetRepsHigh }
      : { sets: it.form.rows.map((r) => ({ setType: "working", repsLow: r.repsLow, repsHigh: r.repsHigh })) }),
  }));
  return {
    name: plan.name === "" ? "n" : plan.name,
    ...(plan.notes === null ? {} : { notes: plan.notes }),
    ...(plan.sections.length === 0
      ? {}
      : { sections: plan.sections.map((s, j) => ({ key: `s${j + 1}`, name: s.name, ...(s.notes === null ? {} : { notes: s.notes }) })) }),
    items: items.length === 0 ? [{ exerciseId: STUB_ID }] : items,
  };
}
