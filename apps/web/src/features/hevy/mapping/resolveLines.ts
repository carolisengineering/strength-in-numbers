import {
  MEASURE_RULE_VALUES,
  hevyPairingProblem,
  normalizeExerciseName,
  normalizeExportAs,
  type Exercise,
  type HevyMapping,
  type HevyPair,
  type HevySectionRule,
  type HevyTemplate,
  type HevyType,
  type MappingCsvLine,
  type MeasureRule,
  type Modality,
} from "@sin/core";

import { MODALITY_LABELS } from "../../catalog/labels";
import { visibleRows } from "../../catalog/visibility";
import { HEVY_TYPE_LABELS } from "../labels";
import type { PairInput } from "./useMappingMutations";

/**
 * Spec 20.0 AC19–AC21, §6.4, pure: a parsed mapping file resolved against the user's Hevy templates and SIN catalog.
 * Nothing is guessed (D4): a title two templates share, or a name two visible exercises normalize to, is left out as
 * ambiguous with its line number. Every lookup is a map built once, so each line costs O(1).
 */

export type LeftOutReason = "hevy_not_found" | "sin_not_found" | "hevy_ambiguous" | "sin_ambiguous" | "type_mismatch" | "retired" | "duplicate";

export interface LeftOut {
  line: number;
  hevyWritten: string;
  sinWritten: string;
  reason: LeftOutReason;
  hevyTypeLabel?: string;
  modalityLabel?: string;
}

/** A pairing that becomes valid with one measure rule; the preview offers it, and `applyRule` takes it. */
export interface NeedsRule {
  line: number;
  templateId: string;
  rule: MeasureRule;
  /** The pair as it will be stored once the rule is accepted. */
  pair: PairInput;
}

export type ResolveNotice =
  | { kind: "id_title_disagree"; line: number }
  | { kind: "export_as_twice"; line: number }
  | { kind: "placeholder_not_found"; which: "warmup" | "workout" };

export interface Resolved {
  pairs: PairInput[];
  sectionRules: HevySectionRule[];
  leftOut: LeftOut[];
  needsRule: NeedsRule[];
  notices: ResolveNotice[];
  placeholders: { warmup: boolean; workout: boolean };
}

/** Gap 1: the one rule that makes this pairing valid when it is not valid without one, else `null`. */
export function fixableRule(hevyType: HevyType, modality: Modality): MeasureRule | null {
  if (hevyPairingProblem(hevyType, modality, null) === null) return null;
  return MEASURE_RULE_VALUES.find((rule) => hevyPairingProblem(hevyType, modality, rule) === null) ?? null;
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

export function resolveLines(
  parsed: { lines: readonly MappingCsvLine[]; lineNumbers: readonly number[] },
  ctx: { templates: readonly HevyTemplate[]; catalog: readonly Exercise[] },
): Resolved {
  const templateById = new Map(ctx.templates.map((t) => [t.id, t]));
  const templatesByTitle = groupBy(ctx.templates, (t) => t.title);
  // Keyed by plain string: a file's id is untrusted text, never a branded id.
  const catalogById = new Map<string, Exercise>(ctx.catalog.map((e) => [e.id, e]));
  const visible = visibleRows(ctx.catalog);
  const visibleIds = new Set<string>(visible.map((e) => e.id));
  const visibleByKey = groupBy(
    visible.filter((e) => normalizeExerciseName(e.name) !== ""),
    (e) => normalizeExerciseName(e.name),
  );

  const out: Resolved = { pairs: [], sectionRules: [], leftOut: [], needsRule: [], notices: [], placeholders: { warmup: true, workout: true } };
  const usedTemplates = new Set<string>();
  const markedExport = new Set<string>();

  parsed.lines.forEach((l, i) => {
    const line = parsed.lineNumbers[i] ?? i + 2;
    if (l.kind === "section") {
      out.sectionRules.push({ name: l.sinName ?? "", treatment: l.rule as HevySectionRule["treatment"] });
      return;
    }
    const hevyWritten = l.hevyId ?? l.hevyTitle ?? "";
    const sinWritten = l.sinId ?? l.sinName ?? "";
    const leave = (reason: LeftOutReason, extra: Partial<LeftOut> = {}) =>
      void out.leftOut.push({ line, hevyWritten, sinWritten, reason, ...extra });

    // The Hevy side: the id wins; else an exact title.
    let template = l.hevyId === null ? undefined : templateById.get(l.hevyId);
    if (template !== undefined && l.hevyTitle !== null && l.hevyTitle !== template.title) out.notices.push({ kind: "id_title_disagree", line });
    if (template === undefined && l.hevyTitle !== null) {
      const matches = templatesByTitle.get(l.hevyTitle) ?? [];
      if (matches.length > 1) {
        if (l.kind === "placeholder") out.placeholders[l.rule as "warmup" | "workout"] = false;
        return leave("hevy_ambiguous");
      }
      template = matches[0];
    }
    if (template === undefined) {
      if (l.kind === "placeholder") {
        const which = l.rule as "warmup" | "workout";
        out.placeholders[which] = false;
        out.notices.push({ kind: "placeholder_not_found", which });
        return;
      }
      return leave("hevy_not_found");
    }
    if (usedTemplates.has(template.id)) return leave("duplicate");

    const base = { hevyTemplateId: template.id, hevyTitle: template.title, hevyType: template.type };
    if (l.kind === "skip") {
      usedTemplates.add(template.id);
      out.pairs.push({ ...base, role: "skip", exerciseId: null, measureRule: null, exportAs: false });
      return;
    }
    if (template.type === null) return leave("type_mismatch");
    if (l.kind === "placeholder") {
      usedTemplates.add(template.id);
      const role = l.rule === "warmup" ? "warmup_placeholder" : "workout_placeholder";
      out.pairs.push({ ...base, role, exerciseId: null, measureRule: null, exportAs: false });
      return;
    }

    // The SIN side: a visible id; a retired id is left out; an unknown id falls back to the name.
    let exercise: Exercise | undefined;
    if (l.sinId !== null) {
      const row = catalogById.get(l.sinId);
      if (row !== undefined && visibleIds.has(row.id)) exercise = row;
      else if (row !== undefined && !row.isActive) return leave("retired");
    }
    if (exercise === undefined) {
      const key = l.sinName === null ? "" : normalizeExerciseName(l.sinName);
      const matches = key === "" ? [] : (visibleByKey.get(key) ?? []);
      if (matches.length > 1) return leave("sin_ambiguous");
      exercise = matches[0];
      if (exercise === undefined) return leave("sin_not_found");
    }

    const written = (l.rule as MeasureRule | null) ?? null;
    const labels = { hevyTypeLabel: HEVY_TYPE_LABELS[template.type], modalityLabel: MODALITY_LABELS[exercise.modality] };
    let exportAs = l.exportAs === true;
    if (exportAs && markedExport.has(exercise.id)) {
      out.notices.push({ kind: "export_as_twice", line });
      exportAs = false;
    }
    const pair: PairInput = { ...base, hevyType: template.type, role: "exercise", exerciseId: exercise.id, measureRule: written, exportAs };
    if (hevyPairingProblem(template.type, exercise.modality, written) === null) {
      usedTemplates.add(template.id);
      if (exportAs) markedExport.add(exercise.id);
      out.pairs.push(pair);
      return;
    }
    const fix = written === null ? fixableRule(template.type, exercise.modality) : null;
    if (fix === null) return leave("type_mismatch", labels);
    usedTemplates.add(template.id);
    if (exportAs) markedExport.add(exercise.id);
    out.needsRule.push({ line, templateId: template.id, rule: fix, pair: { ...pair, measureRule: fix } });
  });

  out.pairs = normalizeExportAs(out.pairs);
  return out;
}

/** AC20: accept the offered rule for one line, moving it into `pairs`. */
export function applyRule(resolved: Resolved, templateId: string): Resolved {
  const target = resolved.needsRule.find((n) => n.templateId === templateId);
  if (target === undefined) return resolved;
  return {
    ...resolved,
    needsRule: resolved.needsRule.filter((n) => n !== target),
    pairs: normalizeExportAs([...resolved.pairs, target.pair]),
  };
}

/** AC21: the current pairings the new file does not carry, so the replace names them before it runs. */
export function willBeRemoved(current: HevyMapping, next: readonly PairInput[]): HevyPair[] {
  const kept = new Set(next.map((p) => p.hevyTemplateId));
  return current.pairs.filter((p) => !kept.has(p.hevyTemplateId));
}
