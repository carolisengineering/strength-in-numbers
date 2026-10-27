/**
 * Spec 19.0 AC1: the Hevy integration's vocabulary. Every list is frozen and in the spec's order; migration
 * `0016`'s CHECK lists render from these (its drift guard, Phase B).
 */

/** Hevy's exercise-template types (its API's `type`). */
export const HEVY_TYPE_VALUES = Object.freeze([
  "weight_reps",
  "reps_only",
  "bodyweight_reps",
  "bodyweight_assisted_reps",
  "duration",
  "weight_duration",
  "distance_duration",
  "short_distance_weight",
] as const);
export type HevyType = (typeof HEVY_TYPE_VALUES)[number];

/** Hevy's set types. */
export const HEVY_SET_TYPE_VALUES = Object.freeze(["warmup", "normal", "failure", "dropset"] as const);
export type HevySetType = (typeof HEVY_SET_TYPE_VALUES)[number];

/** The RPE values Hevy accepts; a SIN RPE is rounded onto these on export (AC9). */
export const HEVY_RPE_STEPS = Object.freeze([6, 7, 7.5, 8, 8.5, 9, 9.5, 10] as const);
export type HevyRpe = (typeof HEVY_RPE_STEPS)[number];

/** How a pair's measures cross over: Hevy reps as SIN calories, or an assisted exercise's weight dropped. */
export const MEASURE_RULE_VALUES = Object.freeze(["calories_as_reps", "assist_weight_ignored"] as const);
export type MeasureRule = (typeof MEASURE_RULE_VALUES)[number];

/** What a Hevy exercise is to SIN: a real exercise, one to skip, or a section marker. */
export const PAIR_ROLE_VALUES = Object.freeze(["exercise", "skip", "warmup_placeholder", "workout_placeholder"] as const);
export type PairRole = (typeof PAIR_ROLE_VALUES)[number];

/** How a SIN section is sent to Hevy (AC10). */
export const SECTION_TREATMENT_VALUES = Object.freeze(["warmup_placeholder", "workout_placeholder", "notes_on_first"] as const);
export type SectionTreatment = (typeof SECTION_TREATMENT_VALUES)[number];

/** How a SIN workout got its Hevy link: a send, an import, or a duplicate match (spec §4). */
export const HEVY_LINK_ORIGIN_VALUES = Object.freeze(["sent", "imported", "matched"] as const);
export type HevyLinkOrigin = (typeof HEVY_LINK_ORIGIN_VALUES)[number];

/** The most pairs one account's mapping may hold. */
export const HEVY_PAIRS_MAX = 2000;
/** The most section rules one account's mapping may hold. */
export const HEVY_SECTION_RULES_MAX = 20;
/** How long a send's claim blocks a second send, in seconds (spec §6.6). */
export const HEVY_LINK_CLAIM_TTL_S = 120;
