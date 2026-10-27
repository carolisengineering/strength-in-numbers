/**
 * Spec 03.4 AC32 — `GET /v1/exercises/usage` latency for a heavy user.
 * A dev tool, not a CI gate. Needs Docker (Testcontainers):
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:exercise-usage
 * Seeds one user with 2,000 finished workouts × 10 exercises × 5 sets, plus 4 other users with the same volume,
 * then times 200 sequential requests through the app (route, query, JSON, ETag). Bulk SQL keeps the seed fast.
 */
import { buildApp } from "../src/app.js";
import { checkDatabaseReady } from "../src/db.js";
import { createHevyRepository } from "../src/repositories/hevy.prisma.js";
import { createAccountExportRepository } from "../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../src/repositories/routine.prisma.js";
import { createUserRepository } from "../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../test/helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../test/helpers/fakes.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { insertExercise, insertUser } from "../test/integration/records-helpers.js";

const WORKOUTS = 2000;
const EXERCISES = 10;
const SETS = 5;
const OTHER_USERS = 4;
const WARMUP = 20;
const RUNS = 200;

const db = await startIntegrationDb();
const app = await buildApp({
  config: testConfig(),
  logger: false,
  checkReadiness: () => checkDatabaseReady(db.prisma),
  tokenVerifier: fakeVerifier(() => authContext({ authSub: "auth0|bench-usage", email: "bench@ex.com" })),
  userRepository: createUserRepository(db.prisma),
  exerciseRepository: createExerciseRepository(db.prisma),
  workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
  personalRecordRepository: createPersonalRecordRepository(db.prisma),
  routineRepository: createRoutineRepository(db.prisma),
  accountExportRepository: createAccountExportRepository(db.prisma),
  hevyRepository: createHevyRepository(db.prisma),
  rateLimits: GENEROUS_LIMITS,
});
const headers = { authorization: "Bearer bench" };
try {
  const me = ((await app.inject({ method: "GET", url: "/v1/me", headers })).json() as { id: string }).id;
  const others = await Promise.all(Array.from({ length: OTHER_USERS }, () => insertUser(db)));
  for (let i = 0; i < EXERCISES; i++) await insertExercise(db);

  const seedStart = performance.now();
  for (const user of [me, ...others]) {
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
       SELECT gen_random_uuid(), $1::uuid, now() - (g || ' hours')::interval * 8, now() - (g || ' hours')::interval * 8 + interval '1 hour',
              (now() - (g || ' hours')::interval * 8)::date, 0, gen_random_uuid()
       FROM generate_series(1, ${WORKOUTS}) g`,
      user,
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout_exercise" ("id","workout_id","position","exercise_id","exercise_name_snapshot","modality_snapshot")
       SELECT gen_random_uuid(), w.id, e.pos, e.id, 'Bench seed', 'weight_reps'
       FROM "workout" w
       CROSS JOIN (SELECT id, (row_number() OVER (ORDER BY id) - 1)::int AS pos FROM "exercise") e
       WHERE w.user_id = $1::uuid`,
      user,
    );
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "set_entry" ("id","workout_exercise_id","set_number","set_type","reps","weight","weight_unit","is_complete")
       SELECT gen_random_uuid(), we.id, s, 'working', 5, 100, 'kg', true
       FROM "workout_exercise" we JOIN "workout" w ON w.id = we.workout_id
       CROSS JOIN generate_series(1, ${SETS}) s
       WHERE w.user_id = $1::uuid`,
      user,
    );
  }
  await db.prisma.$executeRawUnsafe(`ANALYZE`);
  const seeded = (performance.now() - seedStart) / 1000;

  const once = async () => {
    const res = await app.inject({ method: "GET", url: "/v1/exercises/usage", headers });
    if (res.statusCode !== 200) throw new Error(`usage answered ${res.statusCode}`);
    return (res.json() as { exercises: unknown[] }).exercises.length;
  };
  for (let i = 0; i < WARMUP; i++) await once();
  const t: number[] = [];
  let rows = 0;
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    rows = await once();
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const pct = (p: number) => t[Math.min(t.length - 1, Math.ceil((p / 100) * t.length) - 1)]!;
  process.stdout.write(
    `exercise usage over ${WORKOUTS} workouts × ${EXERCISES} exercises × ${SETS} sets (+${OTHER_USERS} users the same; seeded in ${seeded.toFixed(1)} s): ` +
      `${rows} entries, p50 ${pct(50).toFixed(1)} ms, p95 ${pct(95).toFixed(1)} ms, p99 ${pct(99).toFixed(1)} ms (${RUNS} runs)\n`,
  );
} finally {
  await app.close();
  await db.stop();
}
