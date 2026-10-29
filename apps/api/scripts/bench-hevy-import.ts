/**
 * Spec 19.1 AC33 — Hevy import latency: one user with 1,500 finished workouts of 10 exercises × 5 sets, then 1,500
 * more imported in batches of 25 (real runs; a quarter of them match a seeded workout) and the finish. Targets: p95
 * per batch < 2 s, finish < 10 s.
 * A dev tool, not a CI gate. Needs Docker (Testcontainers), like the integration tests:
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:hevy-import
 */
import { HEVY_IMPORT_BATCH_MAX, type HevyImportWorkout } from "@sin/core";
import { pino } from "pino";
import { rebuildRecords } from "../src/records/rebuild.js";
import { createHevyImportRepository } from "../src/repositories/hevy-import.prisma.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { seedPairs } from "../test/integration/hevy-import-helpers.js";
import { insertExercise, insertUser } from "../test/integration/records-helpers.js";

const SEEDED = 1_500;
const IMPORTED = 1_500;
const EXERCISES = 10;
const SETS = 5;
const DAY_MS = 86_400_000;

const db = await startIntegrationDb();
try {
  const user = await insertUser(db);
  const exerciseIds: string[] = [];
  for (let i = 0; i < EXERCISES; i++) exerciseIds.push(await insertExercise(db, { name: `Lift ${i}` }));
  await seedPairs(db, user, exerciseIds.map((exerciseId, i) => ({ hevyTemplateId: `T-${i}`, exerciseId })));

  // The existing history, set-based: one workout a day from 2018, 10 exercises × 5 working sets each.
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout" (id, user_id, title, started_at, ended_at, local_date, tz_offset_minutes, client_generated_id)
     SELECT gen_random_uuid(), $1::uuid, 'Seeded', ts, ts + interval '1 hour', (ts AT TIME ZONE 'UTC')::date, 0, gen_random_uuid()
     FROM (SELECT timestamptz '2018-01-01 10:00Z' + n * interval '1 day' AS ts FROM generate_series(0, $2::int - 1) n) s`,
    user,
    SEEDED,
  );
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_exercise" (id, workout_id, position, exercise_id, exercise_name_snapshot, modality_snapshot)
     SELECT gen_random_uuid(), w.id, e.ord - 1, e.id, 'Seeded', 'weight_reps'
     FROM "workout" w CROSS JOIN unnest($2::uuid[]) WITH ORDINALITY AS e(id, ord)
     WHERE w.user_id = $1::uuid`,
    user,
    exerciseIds,
  );
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "set_entry" (id, workout_exercise_id, set_number, set_type, reps, weight, weight_unit, is_complete)
     SELECT gen_random_uuid(), we.id, s, 'working', 5, 60 + s * 2.5, 'kg', true
     FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id CROSS JOIN generate_series(1, $2::int) s
     WHERE w.user_id = $1::uuid`,
    user,
    SETS,
  );
  await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: user });

  // The imported history: one a day, ending a few days before now (the import refuses a future end). Every fourth
  // one is a seeded session instead (its day, 15 minutes later, its title), so the duplicate step finds candidates
  // and the matched-link transaction runs (minor 165).
  const firstImport = Date.now() - (IMPORTED + 5) * DAY_MS;
  const firstSeeded = Date.parse("2018-01-01T10:15:00Z");
  const workouts: HevyImportWorkout[] = Array.from({ length: IMPORTED }, (_, n) => {
    const overlaps = n % 4 === 0;
    const start = overlaps ? firstSeeded + (n / 4) * DAY_MS : firstImport + n * DAY_MS;
    return {
      hevyWorkoutId: `bench-${n}`,
      title: overlaps ? "Seeded" : `Imported ${n}`,
      description: null,
      startTime: new Date(start).toISOString(),
      endTime: new Date(start + 3_600_000).toISOString(),
      tzOffsetMinutes: 0,
      exercises: Array.from({ length: EXERCISES }, (_, e) => ({
        exerciseTemplateId: `T-${e}`,
        notes: null,
        supersetId: null,
        sets: Array.from({ length: SETS }, (_, s) => ({
          type: "normal" as const,
          weightKg: 60 + (n % 40) + s * 2.5,
          reps: 5,
          distanceMeters: null,
          durationSeconds: null,
          rpe: null,
          customMetric: null,
        })),
      })),
    };
  });

  const repo = createHevyImportRepository(db.prisma);
  const batches: number[] = [];
  let matched = 0;
  for (let i = 0; i < workouts.length; i += HEVY_IMPORT_BATCH_MAX) {
    const t0 = performance.now();
    const out = await repo.importBatch(user, { dryRun: false, workouts: workouts.slice(i, i + HEVY_IMPORT_BATCH_MAX) }, new Date());
    batches.push(performance.now() - t0);
    const bad = out.results.filter((r) => r.outcome !== "create" && r.outcome !== "duplicate");
    if (bad.length > 0) throw new Error(`batch ${i / HEVY_IMPORT_BATCH_MAX}: ${bad.length} neither created nor matched (${bad[0]!.outcome})`);
    matched += out.results.filter((r) => r.outcome === "duplicate").length;
  }
  if (matched === 0) throw new Error("no imported workout matched a seeded one: the duplicate path was not measured");
  const t0 = performance.now();
  const finish = await repo.finishImport(user);
  const finishMs = performance.now() - t0;

  batches.sort((a, b) => a - b);
  const pct = (p: number) => batches[Math.min(batches.length - 1, Math.ceil((p / 100) * batches.length) - 1)]!;
  process.stdout.write(
    `import: ${batches.length} batches of ${HEVY_IMPORT_BATCH_MAX} (${EXERCISES} exercises × ${SETS} sets) over ${SEEDED} seeded workouts: ` +
      `p50 ${pct(50).toFixed(1)} ms, p95 ${pct(95).toFixed(1)} ms, max ${batches.at(-1)!.toFixed(1)} ms\n` +
      `matched: ${matched} of ${IMPORTED} as duplicates (matched-link transactions)\n` +
      `finish: ${finishMs.toFixed(1)} ms (recomputed ${finish.recomputed}, ${finish.rootCount} roots)\n`,
  );
} finally {
  await db.stop();
}
