import { Prisma, type PrismaClient } from "@prisma/client";
import {
  isDuplicateWorkout,
  parseWorkoutId,
  ROUTINE_SECTIONS_MAX,
  translateHevyWorkout,
  type DuplicateSide,
  type HevyImportBatch,
  type HevyImportContext,
  type HevyImportResult,
  type ImportedWorkout,
  type ImportExerciseInfo,
  type Modality,
  type UnitPreference,
} from "@sin/core";
import { uuidv7 } from "uuidv7";
import { ValidationError } from "../errors/app-error.js";
import { fingerprintSourceOf, hevyFingerprint } from "../hevy/fingerprint.js";
import { rebuildUserRecords } from "../records/rebuild.js";
import { lockUserRecords } from "./personal-record.prisma.js";
import { readHevyMapping } from "./hevy.prisma.js";
import {
  emptyHevyImportTally,
  type HevyImportBatchRecord,
  type HevyImportRepository,
  type HevyImportSeams,
  type HevyImportTally,
  type HevyImportWriteStep,
  type HevyLinkHit,
  type WriteOutcome,
} from "./hevy-import.js";
import { isRawUniqueViolation, rawSqlState, violatedConstraintColumns } from "./pg-errors.js";
import { assertSetMeasuresValid } from "./set-writes.js";
import { readWorkoutDetail } from "./workout.prisma.js";

/** A transaction or the client itself: the reads run on either. */
type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Spec 19.1 §6.1: what one import request reads once — the mapping, the exercises it names, the user's unit. Every
 * statement is scoped to `userId`.
 */
export async function loadContext(client: Db, userId: string, now: Date): Promise<HevyImportContext> {
  const mapping = await readHevyMapping(client, userId);
  const ids = [...new Set(mapping.pairs.flatMap((p) => (p.exerciseId === null ? [] : [p.exerciseId])))];
  const rows =
    ids.length === 0
      ? []
      : await client.$queryRaw<{ id: string; name: string; modality: string; is_active: boolean; root_id: string }[]>`
          SELECT id::text, name, modality, is_active, COALESCE(forked_from_exercise_id, id)::text AS root_id
          FROM "exercise"
          WHERE id = ANY(${ids}::uuid[]) AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)`;
  const exercises = new Map<string, ImportExerciseInfo>(
    rows.map((r) => [r.id, { name: r.name, modality: r.modality as Modality, active: r.is_active, rootId: r.root_id }]),
  );
  const user = await client.$queryRaw<{ unit_preference: string }[]>`
    SELECT unit_preference FROM "user" WHERE id = ${userId}::uuid`;
  return {
    pairs: new Map(mapping.pairs.map((p) => [p.hevyTemplateId, p])),
    exercises,
    unit: (user[0]?.unit_preference ?? "kg") as UnitPreference,
    now,
  };
}

/** AC20: the caller's links for these Hevy ids, in one statement (`hevy_link_hevy_id_key`). */
export async function findLinks(client: Db, userId: string, hevyIds: readonly string[]): Promise<Map<string, HevyLinkHit>> {
  if (hevyIds.length === 0) return new Map();
  const rows = await client.$queryRaw<{ hevy_workout_id: string; workout_id: string | null; origin: HevyLinkHit["origin"] }[]>`
    SELECT hevy_workout_id, workout_id::text AS workout_id, origin
    FROM "hevy_link"
    WHERE user_id = ${userId}::uuid AND hevy_workout_id = ANY(${[...hevyIds]}::text[])`;
  return new Map(rows.map((r) => [r.hevy_workout_id, { workoutId: r.workout_id, origin: r.origin }]));
}

/**
 * AC21, §6.3: the caller's finished, unlinked workouts on `localDate` starting within an hour of `startedAt`, with
 * their lineage roots. The SQL narrows; `isDuplicateWorkout` decides.
 */
export async function findCandidates(
  client: Db,
  userId: string,
  localDate: string,
  startedAt: string,
): Promise<(DuplicateSide & { id: string })[]> {
  const rows = await client.$queryRaw<{ id: string; title: string | null; started_at: string; local_date: string; roots: string[] }[]>`
    SELECT w.id::text, w.title,
           to_char(w.started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS started_at,
           to_char(w.local_date, 'YYYY-MM-DD') AS local_date,
           array_agg(DISTINCT COALESCE(e.forked_from_exercise_id, e.id)::text) AS roots
    FROM "workout" w
    JOIN "workout_exercise" we ON we.workout_id = w.id
    JOIN "exercise" e ON e.id = we.exercise_id
    WHERE w.user_id = ${userId}::uuid AND w.ended_at IS NOT NULL AND w.local_date = ${localDate}::date
      AND w.started_at BETWEEN ${startedAt}::timestamptz - interval '1 hour' AND ${startedAt}::timestamptz + interval '1 hour'
      -- Any link row, a claim-only one included: §6.3 excludes only linked rows, but a claim (a Send that never
      -- completed) would make the dry run say duplicate while the real run's insert hits hevy_link_workout_key.
      AND NOT EXISTS (SELECT 1 FROM "hevy_link" l WHERE l.workout_id = w.id)
    GROUP BY w.id`;
  return rows.map((r) => ({ id: r.id, title: r.title, startedAt: r.started_at, localDate: r.local_date, rootIds: r.roots }));
}

/** Rows per multi-row `set_entry` insert: 12 parameters a row stays well under Postgres's 65 535 (200 × 200 sets). */
const SET_ROWS_PER_STATEMENT = 1_000;

/** Thrown inside the write transaction when the link insert finds the Hevy id taken; rolls the workout back. */
class AlreadyLinkedSignal extends Error {}
/** Thrown inside the write transaction when an exercise is no longer usable; rolls back, answers `rejected`. */
class RejectedSignal extends Error {}

/**
 * AC18: the Postgres failures that mean "this body breaks an invariant" — an FK (an exercise deleted since the
 * context load), a CHECK, a numeric overflow. Anything else is unexpected and rethrown (AC24).
 */
const REJECTED_SQLSTATES: ReadonlySet<string> = new Set(["23503", "23514", "22003"]);

function isRejectedDbError(err: unknown): boolean {
  return REJECTED_SQLSTATES.has(rawSqlState(err) ?? "");
}

/**
 * §6.4: the finished-workout rules, re-checked on the translated body before any statement (the translator enforces
 * them by dropping; this is the last line). The first broken rule, else `null`; it never throws, so no caller can
 * let a 422 escape (minor 164). Exported for its unit test.
 */
export function importableProblem(w: ImportedWorkout): string | null {
  if (Date.parse(w.endedAt) < Date.parse(w.startedAt)) return "ends before it starts";
  if (w.sections.length > ROUTINE_SECTIONS_MAX) return "too many sections";
  if (w.exercises.length === 0) return "no exercises";
  for (const e of w.exercises) {
    if (e.sets.length === 0) return "an exercise with no sets";
    if (e.sectionIndex !== null && (e.sectionIndex < 0 || e.sectionIndex >= w.sections.length)) return "unknown section";
    for (const s of e.sets) {
      try {
        assertSetMeasuresValid(e.modalitySnapshot, {
          setType: s.setType,
          reps: s.reps,
          weight: s.weight,
          weightUnit: s.weightUnit,
          distance: s.distance,
          distanceUnit: s.distanceUnit,
          durationS: s.durationS,
          calories: s.calories,
          isComplete: true,
        });
      } catch (err) {
        if (err instanceof ValidationError) return "a set breaks its measure rules";
        throw err;
      }
    }
  }
  return null;
}

export function createHevyImportRepository(prisma: PrismaClient, seams: HevyImportSeams = {}): HevyImportRepository {
  const step = async (s: HevyImportWriteStep) => {
    await seams.onWriteStep?.(s);
  };

  async function writeImportedWorkout(userId: string, hevyWorkoutId: string, w: ImportedWorkout): Promise<WriteOutcome> {
    if (importableProblem(w) !== null) return { kind: "rejected" };

    const workoutId = uuidv7();
    const sectionIds = w.sections.map(() => uuidv7());
    const exerciseIds = w.exercises.map(() => uuidv7());
    try {
      await prisma.$transaction(
        async (tx) => {
          // An exercise retired since the context load raises no FK error; check it in the transaction (AC18). FOR
          // SHARE holds the rows to the commit, so a retire either landed first (`rejected`) or waits (minor 156).
          const ids = [...new Set(w.exercises.map((e) => e.exerciseId))];
          const usable = await tx.$queryRaw<{ id: string }[]>`
            SELECT id::text FROM "exercise"
            WHERE id = ANY(${ids}::uuid[]) AND is_active AND (owner_user_id IS NULL OR owner_user_id = ${userId}::uuid)
            ORDER BY id
            FOR SHARE`;
          if (usable.length !== ids.length) throw new RejectedSignal();

          await tx.$executeRaw`
            INSERT INTO "workout"
              (id, user_id, title, notes, started_at, ended_at, local_date, tz_offset_minutes,
               client_generated_id, source, created_at, updated_at)
            VALUES
              (${workoutId}::uuid, ${userId}::uuid, ${w.title}, ${w.notes}, ${w.startedAt}::timestamptz,
               ${w.endedAt}::timestamptz, ${w.localDate}::date, ${w.tzOffsetMinutes}, ${uuidv7()}::uuid, 'hevy', now(), now())`;
          await step("workout");

          if (w.sections.length > 0) {
            await tx.$executeRaw`
              INSERT INTO "workout_section" (id, workout_id, position, name, notes, added_in_workout, created_at, updated_at)
              VALUES ${Prisma.join(
                w.sections.map(
                  (s, i) => Prisma.sql`(${sectionIds[i]}::uuid, ${workoutId}::uuid, ${i}, ${s.name}, ${s.notes}, false, now(), now())`,
                ),
              )}`;
          }
          await step("sections");

          await tx.$executeRaw`
            INSERT INTO "workout_exercise"
              (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot, notes, superset_group,
               section_id, created_at, updated_at)
            VALUES ${Prisma.join(
              w.exercises.map(
                (e, i) => Prisma.sql`(${exerciseIds[i]}::uuid, ${workoutId}::uuid, ${i}, ${e.exerciseId}::uuid, ${e.nameSnapshot},
                  ${e.modalitySnapshot}, ${e.notes}, ${e.supersetGroup}::smallint,
                  ${e.sectionIndex === null ? null : sectionIds[e.sectionIndex]}::uuid, now(), now())`,
              ),
            )}`;
          await step("exercises");

          const setRows = w.exercises.flatMap((e, i) =>
            e.sets.map(
              (s) => Prisma.sql`(${uuidv7()}::uuid, ${exerciseIds[i]}::uuid, ${s.setNumber}::smallint, ${s.setType},
                ${s.reps}::smallint, ${s.weight}::numeric, ${s.weightUnit}, ${s.distance}::numeric, ${s.distanceUnit},
                ${s.durationS}::integer, ${s.calories}::smallint, ${s.rpe}::numeric, true, NULL, now(), now())`,
            ),
          );
          for (let i = 0; i < setRows.length; i += SET_ROWS_PER_STATEMENT) {
            await tx.$executeRaw`
              INSERT INTO "set_entry"
                (id, workout_exercise_id, set_number, set_type, reps, weight, weight_unit, distance, distance_unit,
                 duration_s, calories, rpe, is_complete, completed_at, created_at, updated_at)
              VALUES ${Prisma.join(setRows.slice(i, i + SET_ROWS_PER_STATEMENT))}`;
          }
          await step("sets");

          // §6.2: the fingerprint of the workout as stored, through the same reader the link begin uses.
          const detail = await readWorkoutDetail(tx, userId, workoutId);
          const fingerprint = hevyFingerprint(fingerprintSourceOf(detail!));
          const linked = await tx.$queryRaw<{ id: string }[]>`
            INSERT INTO "hevy_link" (id, user_id, workout_id, hevy_workout_id, origin, synced_fingerprint, synced_at)
            VALUES (${uuidv7()}::uuid, ${userId}::uuid, ${workoutId}::uuid, ${hevyWorkoutId}, 'imported', ${fingerprint}, now())
            ON CONFLICT (user_id, hevy_workout_id) WHERE hevy_workout_id IS NOT NULL DO NOTHING
            RETURNING id::text`;
          if (linked.length === 0) throw new AlreadyLinkedSignal();
          await step("link");

          // AC25: the flag rides in the same transaction as the workout. Only a write that changes it updates the
          // row, so a batch of creates writes it once (minor 163). The upsert still locks the row to the commit when
          // its WHERE is false, and `finish` relies on that: its FOR UPDATE waits for an in-flight create, so a
          // create never lands after the rebuild while the finish clears the flag. Keep it a DO UPDATE (never DO
          // NOTHING, never a read first).
          await tx.$executeRaw`
            INSERT INTO "hevy_account" (user_id, records_stale) VALUES (${userId}::uuid, true)
            ON CONFLICT (user_id) DO UPDATE SET records_stale = true, updated_at = now() WHERE NOT hevy_account.records_stale`;
        },
        { timeout: 30_000 },
      );
    } catch (err) {
      if (err instanceof AlreadyLinkedSignal) return { kind: "already_linked" };
      if (err instanceof RejectedSignal || isRejectedDbError(err)) return { kind: "rejected" };
      throw err;
    }
    return { kind: "created", workoutId };
  }

  /**
   * AC21: links a matched SIN workout in its own short transaction. `taken` when a Send in another tab linked or
   * claimed it first (`hevy_link_workout_key`) or it vanished; `already_imported` when the Hevy id was linked first.
   */
  async function insertMatchedLink(userId: string, hevyWorkoutId: string, sinWorkoutId: string): Promise<"linked" | "taken" | "already_imported"> {
    try {
      return await prisma.$transaction(async (tx) => {
        await step("match");
        // FOR SHARE, as 19.0's link complete: a delete that lands first answers `taken`, not an FK error (a 500), and
        // a finished-workout edit waits, so the stored fingerprint is of the workout as linked.
        const owned = await tx.$queryRaw<{ id: string }[]>`
          SELECT id::text FROM "workout" WHERE id = ${sinWorkoutId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
        if (owned.length === 0) return "taken" as const;
        const detail = await readWorkoutDetail(tx, userId, sinWorkoutId);
        if (detail === null) return "taken" as const;
        await tx.$executeRaw`
          INSERT INTO "hevy_link" (id, user_id, workout_id, hevy_workout_id, origin, synced_fingerprint, synced_at)
          VALUES (${uuidv7()}::uuid, ${userId}::uuid, ${sinWorkoutId}::uuid, ${hevyWorkoutId}, 'matched',
                  ${hevyFingerprint(fingerprintSourceOf(detail))}, now())`;
        return "linked" as const;
      });
    } catch (err) {
      if (!isRawUniqueViolation(err)) throw err;
      return violatedConstraintColumns(err) === "workout_id" ? "taken" : "already_imported";
    }
  }

  async function importBatch(
    userId: string,
    batch: HevyImportBatch,
    now: Date,
    tally: HevyImportTally = emptyHevyImportTally(),
  ): Promise<HevyImportBatchRecord> {
    // §6.1: loaded once per request, so the whole batch is translated against one consistent mapping.
    const ctx = await loadContext(prisma, userId, now);
    const links = await findLinks(prisma, userId, batch.workouts.map((w) => w.hevyWorkoutId));
    // What this request has already decided, so a dry run answers as the real run will (D6, Review Focus 1 and 4).
    const decided = new Map<string, HevyLinkHit["origin"]>();
    const claimed = new Set<string>();
    const results: HevyImportResult[] = [];
    // Minor 210: this batch's own totals; the caller's tally gets the same counts as each workout is answered.
    let setsCreated = 0;
    let setsDropped = 0;

    for (const w of batch.workouts) {
      const base: HevyImportResult = {
        hevyWorkoutId: w.hevyWorkoutId,
        outcome: "create",
        workoutId: null,
        matchedWorkoutId: null,
        unpaired: [],
        drops: [],
        notices: [],
        exerciseCount: 0,
        setCount: 0,
      };
      const answer = (r: Partial<HevyImportResult>) => {
        const result = { ...base, ...r };
        results.push(result);
        tally.results += 1;
        tally.outcomes[result.outcome] = (tally.outcomes[result.outcome] ?? 0) + 1;
      };

      // 1. AC20: a link decides, before any translation.
      const link = links.get(w.hevyWorkoutId);
      if (link !== undefined) {
        answer({ outcome: link.workoutId === null ? "deleted_in_sin" : OUTCOME_FOR_ORIGIN[link.origin] });
        continue;
      }
      const earlier = decided.get(w.hevyWorkoutId);
      if (earlier !== undefined) {
        answer({ outcome: OUTCOME_FOR_ORIGIN[earlier] });
        continue;
      }

      // 2. Translate.
      const t = translateHevyWorkout(w, ctx);
      if (t.outcome === "time_invalid") {
        answer({ outcome: "time_invalid" });
        continue;
      }
      if (t.outcome === "unpaired") {
        answer({ outcome: "unpaired", unpaired: t.unpaired });
        continue;
      }
      if (t.outcome === "no_usable_sets") {
        answer({ outcome: "no_usable_sets", drops: t.drops, notices: t.notices });
        continue;
      }

      // 3. AC21: duplicates. A candidate a concurrent Send took is dropped and the step re-run once.
      const hevySide = { localDate: t.workout.localDate, startedAt: t.workout.startedAt, title: t.workout.title, rootIds: t.workout.rootIds };
      const dropped = new Set<string>();
      let matched: string | null = null;
      let alreadyImported = false;
      for (let attempt = 0; attempt < 2 && matched === null && !alreadyImported; attempt++) {
        const candidates = await findCandidates(prisma, userId, hevySide.localDate, hevySide.startedAt);
        const best = nearestMatch(hevySide, candidates.filter((c) => !claimed.has(c.id) && !dropped.has(c.id)));
        if (best === null) break;
        if (batch.dryRun) {
          matched = best;
          break;
        }
        const linked = await insertMatchedLink(userId, w.hevyWorkoutId, best);
        if (linked === "linked") matched = best;
        else if (linked === "already_imported") alreadyImported = true;
        else dropped.add(best);
      }
      if (alreadyImported) {
        answer({ outcome: "already_imported" });
        continue;
      }
      if (matched !== null) {
        claimed.add(matched);
        decided.set(w.hevyWorkoutId, "matched");
        answer({ outcome: "duplicate", matchedWorkoutId: parseWorkoutId(matched) });
        continue;
      }

      // 4. A dry run stops here; 5. the write.
      const created = {
        drops: t.drops,
        notices: t.notices,
        exerciseCount: t.workout.exercises.length,
        setCount: t.workout.exercises.reduce((n, e) => n + e.sets.length, 0),
      };
      let workoutId: string | null = null;
      // The real run's pure re-check, once for both runs, so a translator bug reads `rejected` in both (minors 155,
      // 213). `writeImportedWorkout` keeps its own guard: it is the write's test seam.
      if (importableProblem(t.workout) !== null) {
        answer({ outcome: "rejected" });
        continue;
      }
      if (!batch.dryRun) {
        const out = await writeImportedWorkout(userId, w.hevyWorkoutId, t.workout);
        if (out.kind === "already_linked") {
          answer({ outcome: "already_imported" });
          continue;
        }
        if (out.kind === "rejected") {
          answer({ outcome: "rejected" });
          continue;
        }
        workoutId = out.workoutId;
      }
      decided.set(w.hevyWorkoutId, "imported");
      const droppedHere = t.drops.reduce((n, d) => n + (d.code === "exercise_no_sets" ? 0 : d.count), 0);
      setsCreated += created.setCount;
      setsDropped += droppedHere;
      tally.setsCreated += created.setCount;
      tally.setsDropped += droppedHere;
      answer({ outcome: "create", workoutId: workoutId === null ? null : parseWorkoutId(workoutId), ...created });
    }
    return { results, setsCreated, setsDropped };
  }

  /**
   * §6.5, AC26: `lockUserRecords` FIRST (07.0 D9), then the flag row. With no row (no batch created yet) or the flag
   * false, nothing is written; else the caller's records are rebuilt exactly as `records:rebuild --user` does.
   */
  async function finishImport(userId: string): Promise<{ recomputed: boolean; rootCount: number }> {
    return prisma.$transaction(
      async (tx) => {
        await lockUserRecords(tx, userId);
        const rows = await tx.$queryRaw<{ records_stale: boolean }[]>`
          SELECT records_stale FROM "hevy_account" WHERE user_id = ${userId}::uuid FOR UPDATE`;
        if (rows[0]?.records_stale !== true) return { recomputed: false, rootCount: 0 };
        const { rootCount } = await rebuildUserRecords(tx, userId);
        await tx.$executeRaw`
          UPDATE "hevy_account" SET records_stale = false, updated_at = now() WHERE user_id = ${userId}::uuid`;
        return { recomputed: true, rootCount };
      },
      // The same bound as `records:rebuild`'s per-user transaction.
      { timeout: 60_000 },
    );
  }

  return { importBatch, writeImportedWorkout, finishImport };
}

const OUTCOME_FOR_ORIGIN: Readonly<Record<HevyLinkHit["origin"], HevyImportResult["outcome"]>> = Object.freeze({
  sent: "sent_from_sin",
  imported: "already_imported",
  matched: "already_matched",
});

/** AC21: of the candidates `isDuplicateWorkout` accepts, the nearest start, then the lowest id. */
function nearestMatch(h: DuplicateSide, candidates: readonly (DuplicateSide & { id: string })[]): string | null {
  const start = Date.parse(h.startedAt);
  let best: { id: string; gap: number } | null = null;
  for (const c of candidates) {
    if (!isDuplicateWorkout(h, c)) continue;
    const gap = Math.abs(Date.parse(c.startedAt) - start);
    if (best === null || gap < best.gap || (gap === best.gap && c.id < best.id)) best = { id: c.id, gap };
  }
  return best?.id ?? null;
}
