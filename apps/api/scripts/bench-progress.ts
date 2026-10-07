/**
 * Spec 07.2 AC19 — progress series latency over ~2 years of one exercise.
 * A dev tool, not a CI gate. Needs Docker (Testcontainers):
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:progress
 */
import { createPersonalRecordRepository } from "../src/repositories/personal-record.prisma.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { insertExercise, insertUser, logWorkout } from "../test/integration/records-helpers.js";

const SESSIONS = 200; // ~2 years at two sessions a week
const RUNS = 50;

const db = await startIntegrationDb();
try {
  const user = await insertUser(db);
  const bench = await insertExercise(db);
  const noise = await Promise.all([0, 1, 2, 3, 4].map(() => insertExercise(db)));
  const firstAt = Date.now() - (SESSIONS + 1) * 3.5 * 86_400_000;
  for (let n = 0; n < SESSIONS; n++) {
    await logWorkout(db, user, {
      startedAt: new Date(firstAt + n * 3.5 * 86_400_000),
      exercises: [bench, ...noise].map((exerciseId) => ({
        exerciseId,
        sets: Array.from({ length: 4 }, (_, s) => ({ reps: 5 + (s % 3), weight: 60 + (n % 40) + s * 2.5 })),
      })),
    });
  }
  const repo = createPersonalRecordRepository(db.prisma);
  const t: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const t0 = performance.now();
    await repo.getProgressSeries(user, bench, {});
    t.push(performance.now() - t0);
  }
  t.sort((a, b) => a - b);
  const pct = (p: number) => t[Math.min(t.length - 1, Math.ceil((p / 100) * t.length) - 1)]!;
  process.stdout.write(
    `progress series over ${SESSIONS} sessions (4 sets, 5 noise exercises): p50 ${pct(50).toFixed(1)} ms, p99 ${pct(99).toFixed(1)} ms\n`,
  );
} finally {
  await db.stop();
}
