/**
 * Spec 07.0 AC27 — finish-path latency on ~2 years of one user's history; Spec 07.4 AC33 adds a
 * finished-workout set edit (set edit + lineage recompute) on the same history.
 * A dev tool, not a CI gate (D19). Needs Docker (Testcontainers), like the
 * integration tests:
 *   PATH="$HOME/.docker/bin:$PATH" pnpm --filter @sin/api run bench:finish
 * Spec 07.5 AC29 (b): `-- --reps-at-weight` gives every exercise 30 distinct weights at 6–15 reps, so each holds
 * ~30 `max_reps_at_weight` rows, and then times the unfiltered `GET /v1/personal-records` read (with its JSON size)
 * over a second user's 100 lineages × 30 weights.
 */
import { pino } from "pino";
import { createExerciseRepository } from "../src/repositories/exercise.prisma.js";
import { createPersonalRecordRepository } from "../src/repositories/personal-record.prisma.js";
import { toPersonalRecordDto } from "../src/routes/personal-records.js";
import { createWorkoutRepository } from "../src/repositories/workout.prisma.js";
import { createScopedDb } from "../src/db/scoped.js";
import { assertMeasuringAsApp, benchLoginLine } from "./lib/bench-login.js";
import { rebuildRecords } from "../src/records/rebuild.js";
import { startIntegrationDb } from "../test/integration/helpers.js";
import { insertExercise, insertUser, logWorkout } from "../test/integration/records-helpers.js";

const HISTORY_SESSIONS = 100; // ~2 years at one session a week
const EXERCISES = 6;
const SETS = 4;
const RUNS = 50;
const REPS_AT_WEIGHT = process.argv.includes("--reps-at-weight");
const WEIGHTS = 30;
const LIST_LINEAGES = 100;

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
      sets: Array.from({ length: SETS }, (_, s) =>
        REPS_AT_WEIGHT
          ? { reps: 6 + ((n + s) % 10), weight: 20 + ((n * SETS + s) % WEIGHTS) * 2.5 } // 30 weights, 6–15 reps
          : { reps: 5 + (s % 3), weight: 60 + (n % 40) + s * 2.5 },
      ),
    }));

  for (let n = 0; n < HISTORY_SESSIONS; n++) {
    await logWorkout(db, user, { startedAt: sessionAt(n), exercises: exercisesFor(n) }); // raw-finished
  }
  await rebuildRecords(db.prisma, pino({ level: "silent" }), {});

  // Spec 21.1 AC37: measured through sin_app with RLS on, as server.ts wires it; fixtures stay on the owner client.
  process.stdout.write(`${benchLoginLine(await assertMeasuringAsApp(db.app))}\n`);
  const scoped = createScopedDb(db.app);
  const repo = createWorkoutRepository(scoped, createExerciseRepository(scoped));
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

  if (REPS_AT_WEIGHT) {
    // Spec 07.5 AC29: the unfiltered list over 100 lineages × 30 weights, read as the API reads it.
    const lister = await insertUser(db);
    for (let e = 0; e < LIST_LINEAGES; e++) {
      const exerciseId = await insertExercise(db);
      await logWorkout(db, lister, {
        startedAt: sessionAt(e % HISTORY_SESSIONS),
        exercises: [{ exerciseId, sets: Array.from({ length: WEIGHTS }, (_, w) => ({ reps: 8, weight: 20 + w * 2.5 })) }],
      });
    }
    await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: lister });
    const records = createPersonalRecordRepository(scoped);
    const reads: number[] = [];
    let bytes = 0;
    let rows = 0;
    for (let r = 0; r < RUNS; r++) {
      const t0 = performance.now();
      const listed = await records.list(lister, {});
      bytes = Buffer.byteLength(JSON.stringify({ records: listed.map(toPersonalRecordDto) }));
      reads.push(performance.now() - t0);
      rows = listed.length;
    }
    report(`GET /v1/personal-records unfiltered (${rows} rows, ${(bytes / 1024).toFixed(0)} KiB)`, reads);
  }
} finally {
  await db.stop();
}
