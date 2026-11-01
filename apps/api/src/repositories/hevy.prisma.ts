import type { Prisma, PrismaClient } from "@prisma/client";
import {
  HEVY_LINK_CLAIM_TTL_S,
  HEVY_PAIRS_MAX,
  isWorkoutId,
  normalizeExportAs,
  sectionKey,
  type HevyLinkState,
  type HevyMapping,
  type HevyMappingPatch,
  type HevyMappingPut,
  type HevyPair,
  type HevyPairInput,
  type HevySectionRule,
  type Modality,
} from "@sin/core";
import {
  HevyIdInUseError,
  HevyLinkConflictError,
  HevyNoClaimError,
  HevySendInProgressError,
  HevyWorkoutNotFinishedError,
  NotFoundError,
  ValidationError,
} from "../errors/app-error.js";
import { fingerprintSourceOf, fingerprintVersion, hevyFingerprint } from "../hevy/fingerprint.js";
import { validateMappingInput, type VisibleExercise } from "../hevy/mappingValidation.js";
import type { HevyLinkBeginRecord, HevyRepository, HevyStatusRecord } from "./hevy.js";
import { isRawUniqueViolation, violatedConstraintColumns } from "./pg-errors.js";
import { readWorkoutDetail } from "./workout.prisma.js";

type Tx = Prisma.TransactionClient;

/** A pair row as the mapping read and the account export select it. */
export interface HevyPairRow {
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
export function toHevyPair(row: HevyPairRow): HevyPair {
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
  const pairs = await db.$queryRaw<HevyPairRow[]>`
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

/**
 * §6.7: serializes two mapping writers for one user without a new advisory key (D16). `NO KEY UPDATE`, so rows that
 * point at the user (a workout start, an exercise create: FK `KEY SHARE`) are not held up (deferred minor 143).
 */
async function lockUser(tx: Tx, userId: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM "user" WHERE id = ${userId}::uuid FOR NO KEY UPDATE`;
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
 * index (one exportAs per user and exercise) is checked row by row. Upserted rows are already written unflagged; a
 * previous holder upserted with `exportAs: false` (`demoted`) gives up the flag to the exercise's oldest other pair,
 * keeping it only when it is the exercise's one pair (deferred minor 141).
 */
async function settleExportAs(tx: Tx, userId: string, marked: ReadonlyMap<string, string>, demoted: ReadonlySet<string>): Promise<void> {
  const rows = await tx.$queryRaw<{ hevy_template_id: string; role: string; exercise_id: string | null; export_as: boolean }[]>`
    SELECT hevy_template_id, role, exercise_id::text AS exercise_id, export_as FROM "hevy_exercise_pair"
    WHERE user_id = ${userId}::uuid ORDER BY created_at, hevy_template_id`;
  const proposed = rows.map((r) => ({
    id: r.hevy_template_id,
    role: r.role as HevyPair["role"],
    exerciseId: r.exercise_id,
    exportAs:
      r.exercise_id !== null && marked.has(r.exercise_id)
        ? marked.get(r.exercise_id) === r.hevy_template_id
        : r.export_as,
  }));
  // Demoted pairs last, so an exercise left with none marked promotes its oldest other pair first.
  const ordered = [...proposed.filter((p) => !demoted.has(p.id)), ...proposed.filter((p) => demoted.has(p.id))];
  const winners = normalizeExportAs(ordered).filter((p) => p.exportAs).map((p) => p.id);
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

interface LinkRow {
  id: string;
  hevy_workout_id: string | null;
  origin: string;
  claimed_at: Date | null;
  synced_fingerprint: string | null;
  synced_at: Date | null;
  fresh: boolean;
}

const NOT_FOUND = "workout not found or not owned by the acting user";
const NONE: HevyLinkState = { state: "none", hevyWorkoutId: null, origin: null, syncedAt: null };

/** The link row of a workout, with whether its claim is younger than the TTL (compared in SQL, against `now()`). */
async function linkRow(db: Tx | PrismaClient, userId: string, workoutId: string, forUpdate: boolean): Promise<LinkRow | null> {
  const rows = forUpdate
    ? await db.$queryRaw<LinkRow[]>`
        SELECT id::text, hevy_workout_id, origin, claimed_at, synced_fingerprint, synced_at,
               coalesce(claimed_at > now() - make_interval(secs => ${HEVY_LINK_CLAIM_TTL_S}), false) AS fresh
        FROM "hevy_link" WHERE workout_id = ${workoutId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`
    : await db.$queryRaw<LinkRow[]>`
        SELECT id::text, hevy_workout_id, origin, claimed_at, synced_fingerprint, synced_at,
               coalesce(claimed_at > now() - make_interval(secs => ${HEVY_LINK_CLAIM_TTL_S}), false) AS fresh
        FROM "hevy_link" WHERE workout_id = ${workoutId}::uuid AND user_id = ${userId}::uuid`;
  return rows[0] ?? null;
}

/**
 * Spec 19.0 AC26: `none` (no row, a live workout, or only a stale claim), `sending` (a fresh claim, no Hevy id),
 * `sent` (linked and the stored fingerprint equals the current one, or carries another version), `changed`.
 */
async function readLinkState(db: Tx | PrismaClient, userId: string, workoutId: string): Promise<HevyLinkState> {
  const detail = await readWorkoutDetail(db, userId, workoutId);
  if (!detail) throw new NotFoundError(NOT_FOUND);
  if (detail.endedAt === null) return NONE;
  const row = await linkRow(db, userId, workoutId, false);
  if (!row) return NONE;
  if (row.hevy_workout_id === null) return row.fresh ? { state: "sending", hevyWorkoutId: null, origin: null, syncedAt: null } : NONE;
  const stored = row.synced_fingerprint;
  const current = hevyFingerprint(fingerprintSourceOf(detail));
  const sent = stored !== null && (stored === current || fingerprintVersion(stored) !== fingerprintVersion(current));
  return {
    state: sent ? "sent" : "changed",
    hevyWorkoutId: row.hevy_workout_id,
    origin: row.origin as HevyLinkState["origin"],
    syncedAt: row.synced_at?.toISOString() ?? null,
  };
}
const DUPLICATE_MARKER = "only one pair may have this role";

/**
 * Minor 212: begin and complete read the whole workout (`readLinkState` → `readWorkoutDetail` and the fingerprint)
 * inside their transaction, under the row locks, so they get an explicit timeout rather than Prisma's default 5 s: the
 * same 30 s the import write passes (`hevy-import.prisma.ts`; change both together).
 */
export const HEVY_LINK_TX_TIMEOUT_MS = 30_000;

/**
 * Spec 19.0 §6: the Hevy mapping and links over raw SQL (the CHECK lists and partial unique indexes are the
 * migration's, `0016`). No advisory lock key (D16): mapping writes lock the user row, a begin locks the workout row.
 */
export function createHevyRepository(prisma: PrismaClient): HevyRepository {
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

        const current = await tx.$queryRaw<{ hevy_template_id: string; role: string; export_as: boolean }[]>`
          SELECT hevy_template_id, role, export_as FROM "hevy_exercise_pair" WHERE user_id = ${userId}::uuid`;
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
        // Only a pair that held the flag before this patch is demoted; a retitled non-holder keeps its age.
        const holders = new Set(current.filter((r) => r.export_as).map((r) => r.hevy_template_id));
        const demoted = new Set(upserts.filter((p) => !p.exportAs && holders.has(p.hevyTemplateId)).map((p) => p.hevyTemplateId));
        await settleExportAs(tx, userId, marked, demoted);
        return readHevyMapping(tx, userId);
      });
    },

    async readLink(userId, workoutId) {
      if (!isWorkoutId(workoutId)) throw new NotFoundError(NOT_FOUND);
      return readLinkState(prisma, userId, workoutId);
    },

    // §6.6: one transaction; the workout row lock serializes two begins. No lockUserRecords (D16).
    async beginLink(userId, workoutId, opts): Promise<HevyLinkBeginRecord> {
      if (!isWorkoutId(workoutId)) throw new NotFoundError(NOT_FOUND);
      return prisma.$transaction(async (tx) => {
        const owned = await tx.$queryRaw<{ ended_at: Date | null }[]>`
          SELECT ended_at FROM "workout" WHERE id = ${workoutId}::uuid AND user_id = ${userId}::uuid FOR UPDATE`;
        if (!owned[0]) throw new NotFoundError(NOT_FOUND);
        if (owned[0].ended_at === null) throw new HevyWorkoutNotFinishedError();

        const row = await linkRow(tx, userId, workoutId, true);
        let begun: Omit<HevyLinkBeginRecord, "source">;
        if (!row) {
          await tx.$executeRaw`
            INSERT INTO "hevy_link" (id, user_id, workout_id, origin, claimed_at)
            VALUES (gen_random_uuid(), ${userId}::uuid, ${workoutId}::uuid, 'sent', now())`;
          begun = { mode: "create", hevyWorkoutId: null, staleClaim: false };
        } else {
          if (row.claimed_at !== null && row.fresh) throw new HevySendInProgressError();
          const staleClaim = row.claimed_at !== null;
          if (row.hevy_workout_id === null || opts.relink) {
            // A claim-only row taken over, or a relink after the Hevy copy was deleted in Hevy (Spec 20.2 AC12).
            await tx.$executeRaw`
              UPDATE "hevy_link" SET hevy_workout_id = NULL, origin = 'sent', claimed_at = now(), updated_at = now()
              WHERE id = ${row.id}::uuid`;
            begun = { mode: "create", hevyWorkoutId: null, staleClaim };
          } else {
            await tx.$executeRaw`UPDATE "hevy_link" SET claimed_at = now(), updated_at = now() WHERE id = ${row.id}::uuid`;
            begun = { mode: "update", hevyWorkoutId: row.hevy_workout_id, staleClaim };
          }
        }
        const detail = await readWorkoutDetail(tx, userId, workoutId);
        return { ...begun, source: fingerprintSourceOf(detail!) };
      }, { timeout: HEVY_LINK_TX_TIMEOUT_MS });
    },

    async completeLink(userId, workoutId, body) {
      if (!isWorkoutId(workoutId)) throw new NotFoundError(NOT_FOUND);
      // The answer is read inside the transaction, under the workout's share lock, so a delete right after the commit
      // can't turn it into a 404 (minor 145).
      return prisma.$transaction(async (tx) => {
        // FOR SHARE, before the link row (deleteWorkout's order): a delete that lands first is a 404, not
        // hevy-no-claim (deferred minor 140).
        const owned = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM "workout" WHERE id = ${workoutId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
        if (!owned[0]) throw new NotFoundError(NOT_FOUND);
        const row = await linkRow(tx, userId, workoutId, true);
        if (!row) throw new HevyNoClaimError();
        // A replay of the same completion: nothing to write (Review Focus 5).
        if (row.claimed_at === null && row.hevy_workout_id === body.hevyWorkoutId && row.synced_fingerprint === body.fingerprint) {
          return readLinkState(tx, userId, workoutId);
        }
        // AC28: another Hevy id on a linked workout is a conflict whether or not a claim is held (a stale tab
        // completing after a newer send), so it is checked before the claim.
        if (row.hevy_workout_id !== null && row.hevy_workout_id !== body.hevyWorkoutId) throw new HevyLinkConflictError();
        if (row.claimed_at === null) throw new HevyNoClaimError();
        const holder = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM "hevy_link"
          WHERE user_id = ${userId}::uuid AND hevy_workout_id = ${body.hevyWorkoutId} AND id <> ${row.id}::uuid`;
        if (holder[0]) throw new HevyIdInUseError();
        try {
          await tx.$executeRaw`
            UPDATE "hevy_link"
            SET hevy_workout_id = ${body.hevyWorkoutId}, synced_fingerprint = ${body.fingerprint}, synced_at = now(),
                claimed_at = NULL, updated_at = now()
            WHERE id = ${row.id}::uuid AND claimed_at IS NOT NULL`;
        } catch (err) {
          // §6.6: a racing complete that took the same Hevy id; named by its columns ($queryRaw has no constraint name).
          if (isRawUniqueViolation(err) && violatedConstraintColumns(err) === "user_id, hevy_workout_id") throw new HevyIdInUseError();
          throw err;
        }
        return readLinkState(tx, userId, workoutId);
      }, { timeout: HEVY_LINK_TX_TIMEOUT_MS });
    },

    // AC30: idempotent; deletes a claim-only row, clears the claim on a linked row, never unlinks.
    async releaseLink(userId, workoutId) {
      if (!isWorkoutId(workoutId)) throw new NotFoundError(NOT_FOUND);
      await prisma.$transaction(async (tx) => {
        // FOR SHARE, as complete: a delete that lands first is a 404, not a 204 that touched nothing.
        const owned = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM "workout" WHERE id = ${workoutId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
        if (!owned[0]) throw new NotFoundError(NOT_FOUND);
        await tx.$executeRaw`
          DELETE FROM "hevy_link" WHERE workout_id = ${workoutId}::uuid AND user_id = ${userId}::uuid AND hevy_workout_id IS NULL`;
        await tx.$executeRaw`
          UPDATE "hevy_link" SET claimed_at = NULL, updated_at = now()
          WHERE workout_id = ${workoutId}::uuid AND user_id = ${userId}::uuid AND claimed_at IS NOT NULL`;
      });
    },
  };
}
