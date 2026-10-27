import { z } from "zod";

import { SECTION_NAME_MAX } from "./routine-section.js";
import { noControlChars } from "./exercise.js";
import {
  HEVY_LINK_ORIGIN_VALUES,
  HEVY_PAIRS_MAX,
  HEVY_SECTION_RULES_MAX,
  HEVY_TYPE_VALUES,
  MEASURE_RULE_VALUES,
  PAIR_ROLE_VALUES,
  SECTION_TREATMENT_VALUES,
} from "../hevy/vocabulary.js";

/**
 * Spec 19.0 §5: the HTTP DTOs the Hevy routes (Phase B) and the web (Specs 20.x) share. Request bodies are strict;
 * every message is fixed text (#57). Cross-field rules (a role with or without an exercise, duplicates, the pairing
 * table) are the server's (AC23), with a `path` per pair.
 */

export const HEVY_TITLE_MAX = 200;
export const HEVY_ID_MAX = 64;
export const HEVY_PATCH_MAX = 200;

const CONTROL_CHARS = "control characters not allowed";
const SECTION_RULE_NAME = "must be 1 to 40 characters after trimming";
const PATCH_EMPTY = "upsert or remove is required";
const FINGERPRINT_FORMAT = "must be a v1 fingerprint";

const hevyId = z.string().min(1).max(HEVY_ID_MAX).refine(noControlChars, CONTROL_CHARS);
const hevyTitle = z.string().min(1).max(HEVY_TITLE_MAX).refine(noControlChars, CONTROL_CHARS);

/** One pair as read (§5.2). */
export const HevyPairSchema = z.object({
  hevyTemplateId: z.string(),
  hevyTitle: z.string(),
  hevyType: z.enum(HEVY_TYPE_VALUES),
  role: z.enum(PAIR_ROLE_VALUES),
  exerciseId: z.string().nullable(),
  exerciseActive: z.boolean().nullable(),
  measureRule: z.enum(MEASURE_RULE_VALUES).nullable(),
  exportAs: z.boolean(),
});

/** One pair as written (§5.3): the read shape minus `exerciseActive`. */
export const HevyPairInputSchema = z.strictObject({
  hevyTemplateId: hevyId,
  hevyTitle,
  hevyType: z.enum(HEVY_TYPE_VALUES),
  role: z.enum(PAIR_ROLE_VALUES),
  exerciseId: z.guid().nullable(),
  measureRule: z.enum(MEASURE_RULE_VALUES).nullable(),
  exportAs: z.boolean(),
});
export type HevyPairInput = z.infer<typeof HevyPairInputSchema>;

/** A section rule: a name that can match a SIN section (1 to `SECTION_NAME_MAX` after trimming). */
export const HevySectionRuleSchema = z.object({
  name: z
    .string()
    .refine((s) => s.trim().length >= 1 && s.trim().length <= SECTION_NAME_MAX, SECTION_RULE_NAME)
    .refine(noControlChars, CONTROL_CHARS),
  treatment: z.enum(SECTION_TREATMENT_VALUES),
});

/** `GET /v1/hevy/mapping` (and the replace and patch replies). */
export const HevyMappingSchema = z.object({
  pairs: z.array(HevyPairSchema),
  sectionRules: z.array(HevySectionRuleSchema),
});

/** `PUT /v1/hevy/mapping`: the whole mapping. */
export const HevyMappingPutSchema = z.strictObject({
  pairs: z.array(HevyPairInputSchema).max(HEVY_PAIRS_MAX),
  sectionRules: z.array(z.strictObject(HevySectionRuleSchema.shape)).max(HEVY_SECTION_RULES_MAX),
});
export type HevyMappingPut = z.infer<typeof HevyMappingPutSchema>;

/** `PATCH /v1/hevy/mapping`: upserts keyed by template id, removals by template id; at least one present. */
export const HevyMappingPatchSchema = z
  .strictObject({
    upsert: z.array(HevyPairInputSchema).max(HEVY_PATCH_MAX).optional(),
    remove: z.array(hevyId).max(HEVY_PATCH_MAX).optional(),
  })
  .refine((b) => b.upsert !== undefined || b.remove !== undefined, PATCH_EMPTY);
export type HevyMappingPatch = z.infer<typeof HevyMappingPatchSchema>;

/** `GET /v1/hevy/status`: the web's one capability probe (a `404` means "hide every Hevy control"). */
export const HevyStatusSchema = z.object({
  enabled: z.literal(true),
  pairCount: z.number().int().min(0),
  linkCount: z.number().int().min(0),
  recordsStale: z.boolean(),
});
export type HevyStatus = z.infer<typeof HevyStatusSchema>;

export const HEVY_LINK_STATE_VALUES = Object.freeze(["none", "sending", "sent", "changed"] as const);
export type HevyLinkStateName = (typeof HEVY_LINK_STATE_VALUES)[number];

/** `GET /v1/workouts/{id}/hevy-link` (and the complete reply). */
export const HevyLinkStateSchema = z.object({
  state: z.enum(HEVY_LINK_STATE_VALUES),
  hevyWorkoutId: z.string().nullable(),
  origin: z.enum(HEVY_LINK_ORIGIN_VALUES).nullable(),
  syncedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type HevyLinkState = z.infer<typeof HevyLinkStateSchema>;

/** `POST …/hevy-link` body: none, or `{ relink: true }` (the Hevy copy was deleted in Hevy). */
export const HevyLinkBeginBodySchema = z.strictObject({ relink: z.literal(true).optional() });
export type HevyLinkBeginBody = z.infer<typeof HevyLinkBeginBodySchema>;

/** `POST …/hevy-link` reply. */
export const HevyLinkBeginSchema = z.object({
  mode: z.enum(["create", "update"]),
  hevyWorkoutId: z.string().nullable(),
  staleClaim: z.boolean(),
  fingerprint: z.string(),
});
export type HevyLinkBegin = z.infer<typeof HevyLinkBeginSchema>;

/** `PUT …/hevy-link` body: the Hevy id and the begin's fingerprint. */
export const HevyLinkCompleteSchema = z.strictObject({
  hevyWorkoutId: hevyId,
  fingerprint: z.string().regex(/^v1:[0-9a-f]{64}$/, FINGERPRINT_FORMAT),
});
export type HevyLinkComplete = z.infer<typeof HevyLinkCompleteSchema>;
