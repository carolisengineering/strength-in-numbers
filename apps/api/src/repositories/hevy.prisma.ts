import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HEVY_PAIRS_MAX,
  normalizeExportAs,
  sectionKey,
  type HevyMapping,
  type HevyMappingPatch,
  type HevyMappingPut,
  type HevyPair,
  type HevyPairInput,
  type HevySectionRule,
  type Modality,
} from "@sin/core";
import { ValidationError } from "../errors/app-error.js";
import { validateMappingInput, type VisibleExercise } from "../hevy/mappingValidation.js";
import type { HevyRepository, HevyStatusRecord } from "./hevy.js";

type Tx = Prisma.TransactionClient;

interface PairRow {
  hevy_template_id: string;
  hevy_title: string;
  hevy_type: string | null;
  role: string;
  exercise_id: string | null;
  is_active: boolean | null;
  measure_rule: string | null;
  export_as: boolean;
}

/** A stored pair as the read shape (§5.2). `exerciseActive` is `null` for a role other than exercise. */
export function toHevyPair(row: PairRow): HevyPair {
  return {
    hevyTemplateId: row.hevy_template_id,
    hevyTitle: row.hevy_title,
    hevyType: row.hevy_type as HevyPair["hevyType"],
    role: row.role as HevyPair["role"],
    exerciseId: row.exercise_id,
    exerciseActive: row.exercise_id === null ? null : row.is_active === true,
    measureRule: row.measure_rule as HevyPair["measureRule"],
    exportAs: row.export_as,
  };
}

/** Spec 19.0 AC21: pairs by lowercase title then id, rules by name key. Never another user's rows. */
export async function readHevyMapping(db: Tx | PrismaClient, userId: string): Promise<HevyMapping> {
  const pairs = await db.$queryRaw<PairRow[]>`
    SELECT p.hevy_template_id, p.hevy_title, p.hevy_type, p.role, p.exercise_id::text AS exercise_id, e.is_active,
           p.measure_rule, p.export_as
    FROM "hevy_exercise_pair" p LEFT JOIN "exercise" e ON e.id = p.exercise_id
    WHERE p.user_id = ${userId}::uuid
    ORDER BY lower(p.hevy_title), p.hevy_template_id`;
  const rules = await db.$queryRaw<{ name: string; treatment: string }[]>`
    SELECT name, treatment FROM "hevy_section_rule" WHERE user_id = ${userId}::uuid ORDER BY name_key`;
  return {
    pairs: pairs.map(toHevyPair),
    sectionRules: rules.map((r) => ({ name: r.name, treatment: r.treatment as HevySectionRule["treatment"] })),
  };
}

/** §6.7: serializes two mapping writers for one user without a new advisory key (D16). */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE id = ${userId}::uuid FOR UPDATE`;
}

/** The exercises a write names that the caller can see (the 03.2 predicate); retired ones are reported as such. */
async function visibleExercises(tx: Tx, userId: string, pairs: readonly HevyPairInput[]): Promise<Map<string, VisibleExercise>> {
  const ids = [...new Set(pairs.flatMap((p) => (p.exerciseId === null ? [] : [p.exerciseId])))];
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; modality: string; is_active: boolean }[]>`
    SELECT id::text, modality, is_active FROM "exercise"
    WHERE id = ANY(${ids}::uuid[]) AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)`;
  return new Map(rows.map((r) => [r.id, { modality: r.modality as Modality, isActive: r.is_active }]));
}

async function insertPairs(tx: Tx, userId: string, pairs: readonly HevyPairInput[], exportAs: (p: HevyPairInput) => boolean): Promise<void> {
  if (pairs.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO "hevy_exercise_pair" (user_id, hevy_template_id, hevy_title, hevy_type, role, exercise_id, measure_rule, export_as)
    SELECT ${userId}::uuid, t.template_id, t.title, t.hevy_type, t.role, t.exercise_id::uuid, t.rule, t.export_as
    FROM unnest(
      ${pairs.map((p) => p.hevyTemplateId)}::text[],
      ${pairs.map((p) => p.hevyTitle)}::text[],
      ${pairs.map((p) => p.hevyType)}::text[],
      ${pairs.map((p) => p.role)}::text[],
      ${pairs.map((p) => p.exerciseId)}::text[],
      ${pairs.map((p) => p.measureRule)}::text[],
      ${pairs.map(exportAs)}::boolean[]
    ) AS t(template_id, title, hevy_type, role, exercise_id, rule, export_as)
    ON CONFLICT (user_id, hevy_template_id) DO UPDATE SET
      hevy_title = EXCLUDED.hevy_title, hevy_type = EXCLUDED.hevy_type, role = EXCLUDED.role,
      exercise_id = EXCLUDED.exercise_id, measure_rule = EXCLUDED.measure_rule, export_as = EXCLUDED.export_as,
      updated_at = now()`;
}

/**
 * AC24: after a patch, every exercise with pairs has exactly one exportAs. Clear first, then set: the partial unique
 * index (one exportAs per user and exercise) is checked row by row.
 */
async function settleExportAs(tx: Tx, userId: string, marked: ReadonlyMap<string, string>): Promise<void> {
  const rows = await tx.$queryRaw<{ hevy_template_id: string; role: string; exercise_id: string | null; export_as: boolean }[]>`
    SELECT hevy_template_id, role, exercise_id::text AS exercise_id, export_as FROM "hevy_exercise_pair"
    WHERE user_id = ${userId}::uuid ORDER BY created_at, hevy_template_id`;
  const proposed = rows.map((r) => ({
    id: r.hevy_template_id,
    role: r.role as HevyPair["role"],
    exerciseId: r.exercise_id,
    exportAs: r.exercise_id !== null && marked.has(r.exercise_id) ? marked.get(r.exercise_id) === r.hevy_template_id : r.export_as,
  }));
  const winners = normalizeExportAs(proposed).filter((p) => p.exportAs).map((p) => p.id);
  if (winners.length === 0) {
    // No exercise pair left (only skips and markers): nothing may stay flagged.
    await tx.$executeRaw`UPDATE "hevy_exercise_pair" SET export_as = false, updated_at = now() WHERE user_id = ${userId}::uuid AND export_as`;
    return;
  }
  await tx.$executeRaw`
    UPDATE "hevy_exercise_pair" SET export_as = false, updated_at = now()
    WHERE user_id = ${userId}::uuid AND export_as AND NOT (hevy_template_id = ANY(${winners}::text[]))`;
  await tx.$executeRaw`
    UPDATE "hevy_exercise_pair" SET export_as = true, updated_at = now()
    WHERE user_id = ${userId}::uuid AND NOT export_as AND hevy_template_id = ANY(${winners}::text[])`;
}

const TOO_MANY_PAIRS = "the mapping would hold more pairs than allowed";
const DUPLICATE_MARKER = "only one pair may have this role";

/**
 * Spec 19.0 §6: the Hevy mapping and links over raw SQL (the CHECK lists and partial unique indexes are the
 * migration's, `0016`). No advisory lock key (D16): mapping writes lock the user row, a begin locks the workout row.
 */
export function createHevyRepository(prisma: PrismaClient): HevyRepository {
  const notYet = (what: string) => async (): Promise<never> => {
    throw new Error(`HevyRepository.${what}: not implemented`);
  };

  return {
    async status(userId): Promise<HevyStatusRecord> {
      const rows = await prisma.$queryRaw<{ pairs: bigint; links: bigint; stale: boolean | null }[]>`
        SELECT
          (SELECT count(*) FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid) AS pairs,
          (SELECT count(*) FROM "hevy_link" WHERE user_id = ${userId}::uuid AND hevy_workout_id IS NOT NULL) AS links,
          (SELECT records_stale FROM "hevy_account" WHERE user_id = ${userId}::uuid) AS stale`;
      const row = rows[0]!;
      return { pairCount: Number(row.pairs), linkCount: Number(row.links), recordsStale: row.stale === true };
    },

    getMapping: (userId) => readHevyMapping(prisma, userId),

    async replaceMapping(userId, input: HevyMappingPut) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const errors = validateMappingInput(input.pairs, input.sectionRules, await visibleExercises(tx, userId, input.pairs), { mode: "replace" });
        if (errors.length > 0) throw new ValidationError(errors, "hevy mapping replace refused");
        // AC22: none marked → the first pair of each exercise in the body's order.
        const normalized = normalizeExportAs(input.pairs);
        await tx.$executeRaw`DELETE FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid`;
        await tx.$executeRaw`DELETE FROM "hevy_section_rule" WHERE user_id = ${userId}::uuid`;
        await insertPairs(tx, userId, normalized, (p) => p.exportAs);
        if (input.sectionRules.length > 0) {
          await tx.$executeRaw`
            INSERT INTO "hevy_section_rule" (user_id, name_key, name, treatment)
            SELECT ${userId}::uuid, t.name_key, t.name, t.treatment
            FROM unnest(
              ${input.sectionRules.map((r) => sectionKey(r.name))}::text[],
              ${input.sectionRules.map((r) => r.name.trim())}::text[],
              ${input.sectionRules.map((r) => r.treatment)}::text[]
            ) AS t(name_key, name, treatment)`;
        }
        return readHevyMapping(tx, userId);
      });
    },

    async patchMapping(userId, patch: HevyMappingPatch) {
      return prisma.$transaction(async (tx) => {
        await lockUser(tx, userId);
        const upserts = patch.upsert ?? [];
        const removed = new Set(patch.remove ?? []);
        const errors = validateMappingInput(upserts, [], await visibleExercises(tx, userId, upserts), { mode: "patch", prefix: "upsert" });

        const current = await tx.$queryRaw<{ hevy_template_id: string; role: string }[]>`
          SELECT hevy_template_id, role FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid`;
        const upsertIds = new Set(upserts.map((p) => p.hevyTemplateId));
        const kept = current.filter((r) => !removed.has(r.hevy_template_id) && !upsertIds.has(r.hevy_template_id));
        upserts.forEach((p, i) => {
          if ((p.role === "warmup_placeholder" || p.role === "workout_placeholder") && kept.some((r) => r.role === p.role)) {
            errors.push({ path: `upsert.${i}.role`, message: DUPLICATE_MARKER });
          }
        });
        if (kept.length + upsertIds.size > HEVY_PAIRS_MAX) errors.push({ path: "upsert", message: TOO_MANY_PAIRS });
        if (errors.length > 0) throw new ValidationError(errors, "hevy mapping patch refused");

        if (removed.size > 0) {
          await tx.$executeRaw`
            DELETE FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid AND hevy_template_id = ANY(${[...removed]}::text[])`;
        }
        // Written unflagged; settleExportAs then picks each exercise's one exportAs.
        await insertPairs(tx, userId, upserts, () => false);
        const marked = new Map<string, string>();
        for (const p of upserts) if (p.role === "exercise" && p.exportAs && p.exerciseId !== null) marked.set(p.exerciseId, p.hevyTemplateId);
        await settleExportAs(tx, userId, marked);
        return readHevyMapping(tx, userId);
      });
    },

    readLink: notYet("readLink"),
    beginLink: notYet("beginLink"),
    completeLink: notYet("completeLink"),
    releaseLink: notYet("releaseLink"),
  };
}
