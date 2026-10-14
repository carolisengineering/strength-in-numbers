import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { RoutineWriteSchema } from "@sin/core";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { rebuildRecords } from "../../src/records/rebuild.js";
import { ExerciseRetiredError, NotFoundError, WorkoutInProgressExistsError } from "../../src/errors/app-error.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, recordsOf, type RecordRow } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.2 — start copies sections (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const routines = () => createRoutineRepository(db.prisma);
  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  const parse = (b: unknown) => RoutineWriteSchema.parse(b);
  const start = (u: string, routineId?: string, key = uuidv7(), notes: string | null = null) =>
    workouts().createWorkout(u, { clientGeneratedId: key, startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes, routineId }, "UTC");
  const count = async (table: string): Promise<number> =>
    Number((await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT count(*) AS n FROM "${table}"`))[0]!.n);
  /** exercise position → name of the workout section it sits in (null = loose). */
  const mapping = async (u: string, workoutId: string) => {
    const d = await workouts().getWorkoutById(u, workoutId);
    return d.exercises.map((e) => d.sections.find((s) => s.id === e.sectionId)?.name ?? null);
  };

  /** Loose item, an EMPTY section with a note, "Main" ×2, then the SAME exercise again in "Accessory" (Review Focus 1). */
  async function fixture() {
    const u = await insertUser(db);
    const [a, b] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
    const routine = await routines().create(u, parse({
      name: "Push day", notes: "Keep it under 75 minutes.\r\nSecond line",
      sections: [
        { key: "warm", name: "Warm-up", notes: "5 min rowing" },
        { key: "main", name: "Main" },
        { key: "acc", name: "Accessory", notes: "tab\there" },
      ],
      items: [{ exerciseId: a }, { exerciseId: b, sectionKey: "main" }, { exerciseId: a, sectionKey: "main" }, { exerciseId: b, sectionKey: "acc" }],
    }));
    return { u, a, b, routine };
  }

  it("AC13 — sections are copied (empty ones too), exercises land in the section made from their item's, a repeated exercise gets its own", async () => {
    const { u, routine } = await fixture();
    const res = await start(u, routine.id);
    expect(res.sectionCount).toBe(3);
    expect(res.copiedCount).toBe(4);
    const d = await workouts().getWorkoutById(u, res.workout.id);
    expect(d.sections.map((s) => [s.position, s.name, s.notes])).toEqual([[0, "Warm-up", "5 min rowing"], [1, "Main", null], [2, "Accessory", "tab\there"]]);
    expect(d.sections.map((s) => s.id)).not.toContain(routine.sections[0]!.id); // fresh ids
    expect(await mapping(u, res.workout.id)).toEqual([null, "Main", "Main", "Accessory"]);
    expect(Object.keys(res.workout)).not.toContain("sections"); // the start response is the plain Workout
  });

  it("AC13 — a routine with no sections copies none; a routine of only empty sections and a note (Review Focus 5) still copies both", async () => {
    const u = await insertUser(db);
    const a = await insertExercise(db, { ownerUserId: u });
    const plain = await routines().create(u, parse({ name: "Plain", items: [{ exerciseId: a }] }));
    const r1 = await start(u, plain.id);
    expect(r1.sectionCount).toBe(0);
    expect((await workouts().getWorkoutById(u, r1.workout.id)).sections).toEqual([]);
    await workouts().updateWorkout(u, r1.workout.id, { endedAt: new Date(Date.now() + 1000).toISOString() });
    const onlyHeadings = await routines().create(u, parse({ name: "Headings", notes: "Mobility day", sections: [{ key: "k", name: "Hips", notes: "90/90 for 2 min" }], items: [{ exerciseId: a }] }));
    const r2 = await start(u, onlyHeadings.id);
    const d = await workouts().getWorkoutById(u, r2.workout.id);
    expect(d.sections.map((s) => s.name)).toEqual(["Hips"]);
    expect(d.routineNotes).toBe("Mobility day");
    expect(d.exercises.map((e) => e.sectionId)).toEqual([null]);
  });

  it("AC14 — routineNotes is the routine's note verbatim; workout.notes is the lifter's own; a null note stays NULL; a manual start has NULL", async () => {
    const { u, routine } = await fixture();
    const res = await start(u, routine.id, uuidv7(), "my own note");
    const d = await workouts().getWorkoutById(u, res.workout.id);
    expect(d.routineNotes).toBe("Keep it under 75 minutes.\r\nSecond line");
    expect(d.notes).toBe("my own note");
    await workouts().updateWorkout(u, res.workout.id, { endedAt: new Date(Date.now() + 1000).toISOString() });
    const a = await insertExercise(db, { ownerUserId: u });
    const noNote = await routines().create(u, parse({ name: "No note", items: [{ exerciseId: a }] }));
    const r2 = await start(u, noNote.id);
    const raw = await db.prisma.$queryRawUnsafe<{ routine_notes_snapshot: string | null }[]>(`SELECT routine_notes_snapshot FROM "workout" WHERE id = $1::uuid`, r2.workout.id);
    expect(raw[0]!.routine_notes_snapshot).toBeNull();
    await workouts().updateWorkout(u, r2.workout.id, { endedAt: new Date(Date.now() + 1000).toISOString() });
    const manual = await start(u);
    expect((await workouts().getWorkoutById(u, manual.workout.id)).routineNotes).toBeNull();
  });

  it("AC15 — editing, replacing and deleting the routine changes nothing in the workout; deleting the workout cascades its sections", async () => {
    const { u, a, routine } = await fixture();
    const res = await start(u, routine.id);
    const before = JSON.stringify(await workouts().getWorkoutById(u, res.workout.id));
    await routines().replace(u, routine.id, parse({ name: "Push day", notes: "changed", sections: [{ key: "z", name: "Z", notes: "new" }], items: [{ exerciseId: a, sectionKey: "z" }] }));
    expect(JSON.stringify(await workouts().getWorkoutById(u, res.workout.id))).toBe(before);
    await routines().delete(u, routine.id);
    expect(JSON.stringify(await workouts().getWorkoutById(u, res.workout.id))).toBe(before);
    await db.prisma.$executeRawUnsafe(`DELETE FROM "workout" WHERE id = $1::uuid`, res.workout.id);
    expect(await count("workout_section")).toBe(0);
  });

  it("AC16 — a replay after the routine was replaced and deleted copies nothing again and returns the original", async () => {
    const { u, a, routine } = await fixture();
    const key = uuidv7();
    const first = await start(u, routine.id, key);
    const sectionsBefore = await count("workout_section");
    await routines().replace(u, routine.id, parse({ name: "Push day", sections: [{ key: "z", name: "Z" }], items: [{ exerciseId: a, sectionKey: "z" }] }));
    await routines().delete(u, routine.id);
    const replay = await start(u, routine.id, key);
    expect(replay.created).toBe(false);
    expect([replay.copiedCount, replay.plannedSetCount, replay.sectionCount]).toEqual([0, 0, 0]);
    expect(replay.workout.id).toBe(first.workout.id);
    expect(await count("workout_section")).toBe(sectionsBefore);
    expect((await workouts().getWorkoutById(u, first.workout.id)).sections.map((s) => s.name)).toEqual(["Warm-up", "Main", "Accessory"]);
  });

  it("AC16 — a failed start (404, 409 exercise-retired, 409 workout-in-progress-exists) leaves no workout, no section row, no snapshot", async () => {
    const { u, b, routine } = await fixture();
    const other = await insertUser(db);
    const key404 = uuidv7();
    await expect(start(other, routine.id, key404)).rejects.toBeInstanceOf(NotFoundError);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, b);
    const keyRetired = uuidv7();
    await expect(start(u, routine.id, keyRetired)).rejects.toBeInstanceOf(ExerciseRetiredError);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = true WHERE id = $1::uuid`, b);
    await start(u); // an active manual workout
    const sectionsNow = await count("workout_section");
    await expect(start(u, routine.id, uuidv7())).rejects.toBeInstanceOf(WorkoutInProgressExistsError);
    expect(await count("workout_section")).toBe(sectionsNow);
    expect(sectionsNow).toBe(0);
    const leaked = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "workout" WHERE client_generated_id = ANY($1::uuid[]) OR routine_notes_snapshot IS NOT NULL`, [key404, keyRetired]);
    expect(leaked[0]!.n).toBe(0);
  });

  it("AC19 — logging and the PR engine are indifferent to sections: same records live and via records:rebuild", async () => {
    const u = await insertUser(db);
    const v = await insertUser(db);
    const bench = await insertExercise(db, { name: "Bench" });
    const withSections = await routines().create(u, parse({ name: "S", sections: [{ key: "k", name: "K", notes: "n" }], items: [{ exerciseId: bench, sectionKey: "k" }, { exerciseId: bench, sectionKey: "k" }] }));
    const without = await routines().create(v, parse({ name: "S", items: [{ exerciseId: bench }, { exerciseId: bench }] }));
    const run = async (user: string, routineId: string) => {
      const { workout } = await start(user, routineId);
      const d = await workouts().getWorkoutById(user, workout.id);
      expect(d.exercises.flatMap((e) => e.sets)).toEqual([]); // the start creates no set_entry
      for (const [i, we] of d.exercises.entries()) {
        await workouts().createSet(user, we.id, { setType: "working", reps: 5, weight: 100 + i * 10, weightUnit: "kg", isComplete: true });
      }
      await workouts().updateWorkout(user, workout.id, { endedAt: new Date(Date.now() + 60_000).toISOString() });
      return recordsOf(db, user);
    };
    const shape = (rows: RecordRow[]) => rows.map(({ record_type, value, previous_value }) => ({ record_type, value, previous_value }));
    const live = await run(u, withSections.id);
    expect(live.length).toBeGreaterThan(0);
    expect(shape(live)).toEqual(shape(await run(v, without.id)));
    await rebuildRecords(db.prisma, pino({ level: "silent" }), { userId: u });
    expect(shape(await recordsOf(db, u))).toEqual(shape(live));
  });

  it("AC29 — a PUT racing a start: the workout carries the old document or the new one, never a mix", async () => {
    const u = await insertUser(db);
    const [a, b, c] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
    const docA = parse({ name: "R", notes: "A", sections: [{ key: "s", name: "Alpha" }], items: [{ exerciseId: a, sectionKey: "s" }, { exerciseId: b, sectionKey: "s" }] });
    const docB = parse({ name: "R", notes: "B", sections: [{ key: "t", name: "Beta" }, { key: "u", name: "Gamma" }], items: [{ exerciseId: c }, { exerciseId: a, sectionKey: "t" }, { exerciseId: b, sectionKey: "u" }] });
    const created = await routines().create(u, docA);
    const sig = (names: (string | null)[], notes: string | null, sections: string[]) => JSON.stringify([names, notes, sections]);
    const sigA = sig([ "Alpha", "Alpha"], "A", ["Alpha"]);
    const sigB = sig([null, "Beta", "Gamma"], "B", ["Beta", "Gamma"]);
    for (let round = 0; round < 10; round += 1) {
      const target = round % 2 ? docA : docB;
      const [, res] = await Promise.all([routines().replace(u, created.id, target), start(u, created.id)]);
      const d = await workouts().getWorkoutById(u, res.workout.id);
      const got = sig(await mapping(u, res.workout.id), d.routineNotes, d.sections.map((s) => s.name));
      expect([sigA, sigB]).toContain(got);
      await workouts().updateWorkout(u, res.workout.id, { endedAt: new Date(Date.now() + 1000).toISOString() });
      await routines().replace(u, created.id, docA);
    }
  });
});
