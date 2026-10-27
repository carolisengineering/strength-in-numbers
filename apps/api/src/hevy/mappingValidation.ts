import { hevyPairingProblem, sectionKey, type HevyPairInput, type Modality, type SectionTreatment } from "@sin/core";
import type { FieldError } from "../errors/app-error.js";

/** An exercise the caller can see (the 03.2 predicate), with what the pairing rule needs. */
export interface VisibleExercise {
  modality: Modality;
  isActive: boolean;
}

// Spec 19.0 AC23 / AC36: fixed text only; a message never carries a Hevy title, an id or a value (#57).
const EXERCISE_NOT_AVAILABLE = "must be an active exercise you can see";
const EXERCISE_NOT_ALLOWED = "must be null unless role is exercise";
const PAIRING_PROBLEM = "does not fit this Hevy type and SIN exercise type";
const RULE_NOT_ALLOWED = "must be null unless role is exercise";
const TYPE_REQUIRED = "is required unless role is skip";
const DUPLICATE_TEMPLATE = "must be unique";
const DUPLICATE_EXPORT = "only one pair per exercise may be exportAs";
const EXPORT_NOT_ALLOWED = "must be false unless role is exercise";
const DUPLICATE_MARKER = "only one pair may have this role";
const DUPLICATE_RULE = "must be unique (ignoring case and spacing)";

/**
 * Spec 19.0 AC23: the checks a mapping write makes beyond its schema, as field errors with a path such as
 * `pairs.3.exerciseId` (one per pair, the first that fails). `replace` refuses two `exportAs` pairs for one exercise;
 * a `patch` upsert may mark one, and the write then clears its siblings (AC24). Pure: the caller looks up `visible`.
 */
export function validateMappingInput(
  pairs: readonly HevyPairInput[],
  rules: readonly { name: string; treatment: SectionTreatment }[],
  visible: ReadonlyMap<string, VisibleExercise>,
  opts: { mode: "replace" | "patch"; prefix?: string },
): FieldError[] {
  const prefix = opts.prefix ?? "pairs";
  const errors: FieldError[] = [];
  const templates = new Set<string>();
  const exported = new Set<string>();
  const markers = new Set<string>();
  const fail = (i: number, field: string, message: string) => errors.push({ path: `${prefix}.${i}.${field}`, message });

  pairs.forEach((p, i) => {
    if (templates.has(p.hevyTemplateId)) return fail(i, "hevyTemplateId", DUPLICATE_TEMPLATE);
    templates.add(p.hevyTemplateId);
    if (p.role !== "skip" && p.hevyType === null) return fail(i, "hevyType", TYPE_REQUIRED);

    if (p.role === "exercise") {
      const ex = p.exerciseId === null ? undefined : visible.get(p.exerciseId);
      if (!ex || !ex.isActive) return fail(i, "exerciseId", EXERCISE_NOT_AVAILABLE);
      if (hevyPairingProblem(p.hevyType!, ex.modality, p.measureRule) !== null) return fail(i, "measureRule", PAIRING_PROBLEM);
      if (p.exportAs) {
        if (opts.mode === "replace" && exported.has(p.exerciseId!)) return fail(i, "exportAs", DUPLICATE_EXPORT);
        exported.add(p.exerciseId!);
      }
      return;
    }

    if (p.exerciseId !== null) return fail(i, "exerciseId", EXERCISE_NOT_ALLOWED);
    if (p.exportAs) return fail(i, "exportAs", EXPORT_NOT_ALLOWED);
    if (p.measureRule !== null) return fail(i, "measureRule", RULE_NOT_ALLOWED);
    if (p.role !== "skip") {
      if (markers.has(p.role)) return fail(i, "role", DUPLICATE_MARKER);
      markers.add(p.role);
    }
  });

  const names = new Set<string>();
  rules.forEach((r, i) => {
    const key = sectionKey(r.name);
    if (names.has(key)) errors.push({ path: `sectionRules.${i}.name`, message: DUPLICATE_RULE });
    names.add(key);
  });
  return errors;
}
