import type { HevyType, MeasureRule, PairRole, SectionTreatment } from "./vocabulary.js";

/**
 * Spec 19.0 §5.2: one Hevy exercise's place in SIN. `exerciseId` and `exerciseActive` are `null` for a role other
 * than `exercise`. The HTTP DTOs (`dto/hevy.ts`) infer to exactly these shapes (a type test pins it).
 */
export interface HevyPair {
  hevyTemplateId: string;
  hevyTitle: string;
  /** `null` only on a skip of a Hevy template whose type this app does not support (`readHevyType`, D19). */
  hevyType: HevyType | null;
  role: PairRole;
  exerciseId: string | null;
  exerciseActive: boolean | null;
  measureRule: MeasureRule | null;
  exportAs: boolean;
}

export interface HevySectionRule {
  name: string;
  treatment: SectionTreatment;
}

/** A user's pairs plus section rules. */
export interface HevyMapping {
  pairs: HevyPair[];
  sectionRules: HevySectionRule[];
}
