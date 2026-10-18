/**
 * Spec 07.0 AC27 — finish-path latency on ~2 years of one user's history; Spec 07.4 AC33 adds a
 * finished-workout set edit (set edit + lineage recompute) on the same history.
 * A dev tool, not a CI gate (D19). Needs Docker (Testcontainers), like the
 * integration tests:
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:finish
 */
import { pino } from "pino";
import { createExerciseRepository } from "../src/repositories/exercise.prisma.js";
import { createWorkoutRepository } from "../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../src/records/rebuild.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { insertExercise, insertUser, logWorkout } from "../test/integration/records-helpers.js";

const HISTORY_SESSIONS = 100; // ~2 years at one session a week
const EXERCISES = 6;
const SETS = 4;
const RUNS = 50;

const db = await startIntegrationDb();
try {
  const user = await insertUser(db);
  const exerciseIds: string[] = [];
  for (let i = 0; i < EXERCISES; i++) exerciseIds.push(await insertExercise(db));
  // Weekly sessions ending a week before now — finish rejects a future endedAt.
  const WEEK_MS = 7 * 86_400_000;
  const firstAt = Date.now() - (HISTORY_SESSIONS + RUNS + 1) * WEEK_MS;
  const sessionAt = (n: number) => new Date(firstAt + n * WEEK_MS);
  const exercisesFor = (n: number) =>
    exerciseIds.map((exerciseId) => ({
      exerciseId,
      sets: Array.from({ length: SETS }, (_, s) => ({ reps: 5 + (s % 3), weight: 60 + (n % 40) + s * 2.5 })),
    }));

  for (let n = 0; n < HISTORY_SESSIONS; n++) {
    await logWorkout(db, user, { startedAt: sessionAt(n), exercises: exercisesFor(n) }); // raw-finished
  }
  await rebuildRecords(db.prisma, pino({ level: "silent" }), {});

  const repo = createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const timings: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const n = HISTORY_SESSIONS + r;
    const { workoutId } = await logWorkout(db, user, { startedAt: sessionAt(n), finish: "none", exercises: exercisesFor(n) });
    const t0 = performance.now();
    await repo.updateWorkout(user, workoutId, { endedAt: new Date(sessionAt(n).getTime() + 3_600_000).toISOString() });
    timings.push(performance.now() - t0);
  }
  const report = (label: string, samples: number[]) => {
    samples.sort((a, b) => a - b);
    const pct = (p: number) => samples[Math.min(samples.length - 1, Math.ceil((p / 100) * samples.length) - 1)]!;
    process.stdout.write(
      `${label} latency over ${RUNS} runs, ${HISTORY_SESSIONS}+ sessions × ${EXERCISES} exercises × ${SETS} sets: ` +
        `p50 ${pct(50).toFixed(1)} ms, p99 ${pct(99).toFixed(1)} ms, max ${samples.at(-1)!.toFixed(1)} ms\n`,
    );
  };
  report("finish", timings);

  // Spec 07.4 AC33: edit a working set of an old finished workout (weight up, so the lineage recompute
  // runs and moves records), RUNS times across the history.
  const edits: number[] = [];
  for (let r = 0; r < RUNS; r++) {
    const old = await logWorkout(db, user, { startedAt: new Date(sessionAt(r).getTime() + 3_600_000 * 3), exercises: exercisesFor(r) });
    const t0 = performance.now();
    await repo.updateSet(user, old.setIds[0]![0]!, { weight: 200 + r });
    edits.push(performance.now() - t0);
  }
  report("finished-workout set edit", edits);
} finally {
  await db.stop();
}
