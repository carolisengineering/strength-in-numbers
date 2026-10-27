/**
 * Spec 11 §5.3 — the account export document and the delete response. The
 * export is a composition of the existing read DTOs; no field is redeclared
 * (D6), so the file and the read routes cannot disagree.
 */
import { HevyExportSchema } from "./hevy.js";
import { z } from "zod";
import { MeSchema } from "./me.js";
import { ExerciseSchema } from "./exercise.js";
import { RoutineSchema } from "./routine.js";
import { WorkoutDetailSchema } from "./workout.js";

/** Bumped only for a removed/renamed field or changed semantics (D6). */
export const ACCOUNT_EXPORT_FORMAT_VERSION = 1 as const;

/** Days between `DELETE /v1/account` and the earliest purge. The one definition:
 * the 202 body and the purge CLI both read it (Spec 11 D10, AC20). */
export const ACCOUNT_PURGE_GRACE_DAYS = 30;

/** `GET /v1/me` minus the provisioning-only flag. */
export const AccountExportProfileSchema = MeSchema.omit({ isNewUser: true });

export const AccountExportSchema = z.object({
  formatVersion: z.literal(ACCOUNT_EXPORT_FORMAT_VERSION),
  exportedAt: z.iso.datetime({ offset: true }),
  profile: AccountExportProfileSchema,
  /** The caller's custom exercises, including soft-deleted ones and forks. */
  exercises: z.array(ExerciseSchema),
  routines: z.array(RoutineSchema),
  /** Every workout, finished and in-progress, oldest first. */
  workouts: z.array(WorkoutDetailSchema),
  /** Spec 19.0 AC35: the Hevy mapping and links (an added field; the format version stays 1). */
  hevy: HevyExportSchema,
});
export type AccountExport = z.infer<typeof AccountExportSchema>;

export const AccountDeletedResponseSchema = z.object({
  deletedAt: z.iso.datetime({ offset: true }),
  purgeEligibleAt: z.iso.datetime({ offset: true }),
});
export type AccountDeletedResponse = z.infer<typeof AccountDeletedResponseSchema>;
