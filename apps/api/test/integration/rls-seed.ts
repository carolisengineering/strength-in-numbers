// apps/api/test/integration/rls-seed.ts
import { uuidv7 } from "uuidv7";
import { insertExercise, type IntegrationDb } from "./helpers.js";
import { insertLink, seedPairs } from "./hevy-import-helpers.js";
import { logWorkout } from "./records-helpers.js";
import { addTimedSection, recordRounds } from "./section-helpers.js";

export interface SeededUser {
  userId: string;
  customExercise: string;
  workoutId: string;
}

/**
 * Spec 21.1 AC34 — at least one row in every one of the 15 owned tables, plus one custom exercise, for an existing user.
 * Written as the superuser: RLS does not apply to it, and the Phase A fill triggers complete the children's `user_id`.
 */
export async function seedEveryTable(db: IntegrationDb, userId: string): Promise<SeededUser> {
  const customExercise = await insertExercise(db, { ownerUserId: userId });

  // workout, workout_exercise, set_entry
  const { workoutId, setIds } = await logWorkout(db, userId, {
    startedAt: new Date(Date.now() - 86_400_000),
    exercises: [{ exerciseId: customExercise, sets: [{ reps: 5, weight: 100 }] }],
  });

  // workout_section, workout_section_round
  const section = await addTimedSection(db, workoutId, 0, "Timed", { format: "set_timer", roundSeconds: 60, rounds: 3 });
  await recordRounds(db, section, [{ round: 1, seconds: 55 }]);

  // workout_planned_set
  const workoutExercise = (
    await db.prisma.$queryRaw<{ id: string }[]>`SELECT id::text FROM "workout_exercise" WHERE workout_id = ${workoutId}::uuid`
  )[0]!.id;
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "workout_planned_set" (id, workout_exercise_id, position, reps_low, reps_high) VALUES ($1::uuid, $2::uuid, 0, 5, 5)`,
    uuidv7(),
    workoutExercise,
  );

  // personal_record
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "personal_record" (id, user_id, exercise_id, record_type, value, unit, source_set_entry_id, workout_id, achieved_at, local_date)
     VALUES ($1::uuid, $2::uuid, $3::uuid, 'heaviest_weight', 100, 'kg', $4::uuid, $5::uuid, now(), CURRENT_DATE)`,
    uuidv7(),
    userId,
    customExercise,
    setIds[0]![0]!,
    workoutId,
  );

  // routine, routine_section, routine_item, routine_item_set
  const routine = uuidv7();
  await db.prisma.$executeRawUnsafe(`INSERT INTO "routine" (id, user_id, name) VALUES ($1::uuid, $2::uuid, $3)`, routine, userId, `Routine ${routine}`);
  const routineSection = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "routine_section" (id, routine_id, position, name) VALUES ($1::uuid, $2::uuid, 0, 'Section')`,
    routineSection,
    routine,
  );
  const routineItem = uuidv7();
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "routine_item" (id, routine_id, position, exercise_id, section_id) VALUES ($1::uuid, $2::uuid, 0, $3::uuid, $4::uuid)`,
    routineItem,
    routine,
    customExercise,
    routineSection,
  );
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "routine_item_set" (id, routine_item_id, position, reps_low, reps_high) VALUES ($1::uuid, $2::uuid, 0, 5, 5)`,
    uuidv7(),
    routineItem,
  );

  // hevy_exercise_pair, hevy_section_rule, hevy_link, hevy_account
  await seedPairs(db, userId, [{ hevyTemplateId: "T-RLS", exerciseId: customExercise }]);
  await db.prisma.$executeRawUnsafe(
    `INSERT INTO "hevy_section_rule" (user_id, name_key, name, treatment) VALUES ($1::uuid, 'warm up', 'Warm up', 'warmup_placeholder')`,
    userId,
  );
  await insertLink(db, { userId, workoutId, hevyWorkoutId: `hevy-${workoutId}`, origin: "sent" });
  await db.prisma.$executeRawUnsafe(`INSERT INTO "hevy_account" (user_id) VALUES ($1::uuid)`, userId);

  return { userId, customExercise, workoutId };
}
