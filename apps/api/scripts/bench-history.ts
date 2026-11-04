/**
 * Spec 07.1 AC20 — history page latency over ~2 years of one user's history. Spec 09.5 AC25 adds a second run
 * where every workout has two timed sections (a Set Timer with 20 rounds, an AMRAP with 20 readings and a result).
 * A dev tool, not a CI gate. Needs Docker (Testcontainers):
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:history
 */
import { createExerciseRepository } from "../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../src/repositories/workout.prisma.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { insertExercise, insertUser, logWorkout } from "../test/integration/records-helpers.js";

const SESSIONS = 200; // ~2 years at two sessions a week
const EXERCISES = 6;
const SETS = 4;
const RUNS = 50;

const db = await startIntegrationDb();
try {
  const user = await insertUser(db);
  const exerciseIds: string[] = [];
  for (let i = 0; i < EXERCISES; i++) exerciseIds.push(await insertExercise(db));
  const firstAt = Date.now() - (SESSIONS + 1) * 3.5 * 86_400_000;
  for (let n = 0; n < SESSIONS; n++) {
    await logWorkout(db, user, {
      startedAt: new Date(firstAt + n * 3.5 * 86_400_000),
      exercises: exerciseIds.map((exerciseId) => ({
        exerciseId,
        sets: Array.from({ length: SETS }, (_, s) => ({ reps: 5 + (s % 3), weight: 60 + (n % 40) + s * 2.5 })),
      })),
    });
  }
  const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const deepCursor = (await repo.listFinishedWorkouts(user, { limit: 150 })).next!; // 150 rows down
  const time = async (cursor?: string) => {
    const t: number[] = [];
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      await repo.listFinishedWorkouts(user, { limit: 50, cursor });
      t.push(performance.now() - t0);
    }
    t.sort((a, b) => a - b);
    const pct = (p: number) => t[Math.min(t.length - 1, Math.ceil((p / 100) * t.length) - 1)]!;
    return `p50 ${pct(50).toFixed(1)} ms, p95 ${pct(95).toFixed(1)} ms, p99 ${pct(99).toFixed(1)} ms`;
  };
  process.stdout.write(
    `history page (limit 50) over ${SESSIONS} sessions × ${EXERCISES} exercises × ${SETS} sets — ` +
      `first page: ${await time()}; deep page: ${await time(deepCursor)}\n`,
  );

  // Spec 09.5 AC25 — the same pages with two timed sections of 20 round times on every workout.
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_section" (id, workout_id, position, name, timer_format, timer_round_s, timer_rounds, timer_cap_s,
                                    result_rounds, result_reps)
     SELECT gen_random_uuid(), w.id, p, CASE p WHEN 0 THEN 'Main' ELSE 'Finisher' END,
            CASE p WHEN 0 THEN 'set_timer' ELSE 'amrap' END,
            CASE p WHEN 0 THEN 300 END, CASE p WHEN 0 THEN 20 END, CASE p WHEN 1 THEN 3600 END,
            CASE p WHEN 1 THEN 20 END, CASE p WHEN 1 THEN 7 END
     FROM "workout" w, generate_series(0, 1) p WHERE w.user_id = $1::uuid`,
    user,
  );
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_section_round" (workout_section_id, round_no, seconds)
     SELECT s.id, r, CASE s.timer_format WHEN 'set_timer' THEN 200 + r ELSE r * 150 END
     FROM "workout_section" s JOIN "workout" w ON w.id = s.workout_id, generate_series(1, 20) r
     WHERE w.user_id = $1::uuid`,
    user,
  );
  // The cursor encodes the 150th workout's (startedAt, id); adding sections changes neither, so it is reused (#248).
  process.stdout.write(
    `with two timed sections × 20 rounds per workout — first page: ${await time()}; deep page: ${await time(deepCursor)}\n`,
  );
} finally {
  await db.stop();
}
