/**
 * Spec 07.1 AC20 — history page latency over ~2 years of one user's history.
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
    return `p50 ${pct(50).toFixed(1)} ms, p99 ${pct(99).toFixed(1)} ms`;
  };
  process.stdout.write(
    `history page (limit 50) over ${SESSIONS} sessions × ${EXERCISES} exercises × ${SETS} sets — ` +
      `first page: ${await time()}; deep page: ${await time(deepCursor)}\n`,
  );
} finally {
  await db.stop();
}
