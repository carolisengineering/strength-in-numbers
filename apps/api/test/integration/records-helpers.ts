import { uuidv7 } from "uuidv7";
import type { IntegrationDb } from "./helpers.js";

/**
 * Spec 07.0 fixture builders. Workouts are inserted with raw SQL so a test can
 * place `started_at` anywhere (the route's 7-day skew window does not apply)
 * and choose whether the workout is finished.
 */

// #21: the user and exercise fixtures live in helpers.ts; re-exported so the existing imports keep working.
export { insertExercise, insertUser } from "./helpers.js";

export interface SetSpec {
  setType?: "warmup" | "working" | "drop" | "failure";
  reps?: number | null;
  weight?: number | null;
  weightUnit?: "kg" | "lb";
  durationS?: number | null;
  isComplete?: boolean;
}
export interface ExerciseSpec {
  exerciseId: string;
  /** Defaults to the array index; set it to insert rows out of position order. */
  position?: number;
  modality?: string;
  name?: string;
  sets: SetSpec[];
}

/**
 * Inserts a workout, its exercises (positions in array order) and their sets
 * (set_number in array order). `finish: "raw"` (default) stores it already
 * finished WITHOUT running the PR recompute; `finish: "none"` leaves it in
 * progress so a test can finish it through the repository.
 */
export async function logWorkout(
  db: IntegrationDb,
  userId: string,
  spec: { startedAt: Date; exercises: ExerciseSpec[]; finish?: "raw" | "none" },
): Promise<{ workoutId: string; setIds: string[][] }> {
  const workoutId = uuidv7();
  const endedAt = spec.finish === "none" ? null : new Date(spec.startedAt.getTime() + 3_600_000);
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout" ("id","user_id","started_at","ended_at","local_date","tz_offset_minutes","client_generated_id")
     VALUES ($1::uuid,$2::uuid,$3,$4,($3 AT TIME ZONE 'UTC')::date,0,$5::uuid)`,
    workoutId,
    userId,
    spec.startedAt,
    endedAt,
    uuidv7(),
  );
  const setIds: string[][] = [];
  for (const [index, ex] of spec.exercises.entries()) {
    const position = ex.position ?? index;
    const weId = uuidv7();
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "workout_exercise" ("id","workout_id","position","exercise_id","exercise_name_snapshot","modality_snapshot")
       VALUES ($1::uuid,$2::uuid,$3,$4::uuid,$5,$6)`,
      weId,
      workoutId,
      position,
      ex.exerciseId,
      ex.name ?? "Snapshot",
      ex.modality ?? "weight_reps",
    );
    const ids: string[] = [];
    for (const [i, s] of ex.sets.entries()) {
      const id = uuidv7();
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO "set_entry" ("id","workout_exercise_id","set_number","set_type","reps","weight","weight_unit","duration_s","is_complete")
         VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9)`,
        id,
        weId,
        i + 1,
        s.setType ?? "working",
        s.reps ?? null,
        s.weight ?? null,
        s.weight == null ? null : (s.weightUnit ?? "kg"),
        s.durationS ?? null,
        s.isComplete ?? true,
      );
      ids.push(id);
    }
    setIds.push(ids);
  }
  return { workoutId, setIds };
}

export interface RecordRow {
  exercise_id: string;
  record_type: string;
  value: string;
  unit: string;
  previous_value: string | null;
  source_set_entry_id: string;
  workout_id: string;
}

export async function recordsOf(db: IntegrationDb, userId: string): Promise<RecordRow[]> {
  return db.prisma.$queryRawUnsafe<RecordRow[]>(
    `SELECT exercise_id::text, record_type, value::text, unit, previous_value::text,
            source_set_entry_id::text, workout_id::text
     FROM "personal_record" WHERE user_id = $1::uuid ORDER BY exercise_id, record_type`,
    userId,
  );
}

export const TRUNCATE_ALL =
  'TRUNCATE "personal_record", "set_entry", "workout_exercise", "workout", "exercise", "user" CASCADE';
