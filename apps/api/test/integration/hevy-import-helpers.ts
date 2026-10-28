import type { HevyImportWorkout } from "@sin/core";
import { uuidv7 } from "uuidv7";
import type { IntegrationDb } from "./helpers.js";

/** Spec 19.1 Phase B fixture builders for the Hevy import repository tests. */

export interface PairSeed {
  hevyTemplateId: string;
  hevyType?: string | null;
  role?: "exercise" | "skip" | "warmup_placeholder" | "workout_placeholder";
  exerciseId?: string | null;
  measureRule?: string | null;
  title?: string;
}

/** Inserts mapping pairs directly (19.0's routes validate; these tests need any shape the table allows). */
export async function seedPairs(db: IntegrationDb, userId: string, pairs: readonly PairSeed[]): Promise<void> {
  for (const p of pairs) {
    const role = p.role ?? "exercise";
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "hevy_exercise_pair" ("user_id","hevy_template_id","hevy_title","hevy_type","role","exercise_id","measure_rule")
       VALUES ($1::uuid,$2,$3,$4,$5,$6::uuid,$7)
       ON CONFLICT ("user_id","hevy_template_id") DO UPDATE
         SET hevy_type = EXCLUDED.hevy_type, role = EXCLUDED.role, exercise_id = EXCLUDED.exercise_id,
             measure_rule = EXCLUDED.measure_rule`,
      userId,
      p.hevyTemplateId,
      p.title ?? p.hevyTemplateId,
      p.hevyType === undefined ? (role === "skip" ? null : "weight_reps") : p.hevyType,
      role,
      role === "exercise" ? (p.exerciseId ?? null) : null,
      p.measureRule ?? null,
    );
  }
}

/** A linked (or tombstoned, `workoutId: null`) Hevy link row. */
export async function insertLink(
  db: IntegrationDb,
  link: { userId: string; workoutId: string | null; hevyWorkoutId: string | null; origin: "sent" | "imported" | "matched"; claimed?: boolean },
): Promise<string> {
  const id = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "hevy_link" ("id","user_id","workout_id","hevy_workout_id","origin","claimed_at","synced_fingerprint","synced_at")
     VALUES ($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8)`,
    id,
    link.userId,
    link.workoutId,
    link.hevyWorkoutId,
    link.origin,
    link.claimed === true || link.hevyWorkoutId === null ? new Date() : null,
    link.hevyWorkoutId === null ? null : "v1:test",
    link.hevyWorkoutId === null ? null : new Date(),
  );
  return id;
}

/** A valid request workout: one `T-BENCH` exercise with two working sets, finished an hour after it starts. */
export function importWorkoutFixture(overrides: Partial<HevyImportWorkout> = {}): HevyImportWorkout {
  return {
    hevyWorkoutId: `hevy-${uuidv7()}`,
    title: "Push day",
    description: null,
    startTime: "2026-09-10T10:00:00Z",
    endTime: "2026-09-10T11:00:00Z",
    tzOffsetMinutes: 0,
    exercises: [
      {
        exerciseTemplateId: "T-BENCH",
        notes: null,
        supersetId: null,
        sets: [
          { type: "normal", weightKg: 60, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null },
          { type: "normal", weightKg: 62.5, reps: 5, distanceMeters: null, durationSeconds: null, rpe: null, customMetric: null },
        ],
      },
    ],
    ...overrides,
  };
}

/** AC16's seven tables. */
export const IMPORT_TABLES = [
  "workout",
  "workout_section",
  "workout_exercise",
  "set_entry",
  "hevy_link",
  "hevy_account",
  "personal_record",
] as const;

export async function rowCounts(db: IntegrationDb): Promise<Record<(typeof IMPORT_TABLES)[number], number>> {
  const out = {} as Record<(typeof IMPORT_TABLES)[number], number>;
  for (const t of IMPORT_TABLES) {
    const rows = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "${t}"`);
    out[t] = rows[0]!.n;
  }
  return out;
}
