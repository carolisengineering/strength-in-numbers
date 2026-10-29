import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { translateHevyWorkout, WorkoutDetailSchema, type HevyImportWorkout, type ImportedWorkout } from "@sin/core";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { fingerprintSourceOf, hevyFingerprint } from "../../src/hevy/fingerprint.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createHevyImportRepository, loadContext } from "../../src/repositories/hevy-import.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository, readWorkoutDetail } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { importWorkoutFixture, rowCounts, seedPairs } from "./hevy-import-helpers.js";
import { logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const U = "0192a1b2-0000-7000-8000-0000000000aa";
const AUTH = { authorization: "Bearer a" };
const NOW = new Date("2026-10-28T12:00:00Z");
const set = (over: Partial<HevyImportWorkout["exercises"][number]["sets"][number]> = {}) => ({
  type: "normal" as const,
  weightKg: null,
  reps: null,
  distanceMeters: null,
  durationSeconds: null,
  rpe: null,
  customMetric: null,
  ...over,
});

/** Spec 19.1 §6.2 — the per-workout write transaction. */
describe.skipIf(!shouldRunIntegration())("Spec 19.1 — Hevy import write (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  let bench: string;
  let row: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await buildApp({
      config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set([U])) },
      logger: pino({ level: "silent" }),
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: `auth0|${U}` })),
      userRepository: createUserRepository(db.prisma),
      exerciseRepository: createExerciseRepository(db.prisma),
      workoutRepository: createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma)),
      personalRecordRepository: createPersonalRecordRepository(db.prisma),
      routineRepository: createRoutineRepository(db.prisma),
      accountExportRepository: createAccountExportRepository(db.prisma),
      hevyRepository: createHevyRepository(db.prisma),
      hevyImportRepository: createHevyImportRepository(db.prisma),
      rateLimits: GENEROUS_LIMITS,
    });
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  beforeEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
    await insertUser(db, { id: U });
    bench = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
    row = await insertExercise(db, { name: "Row Erg", modality: "calories" });
    await seedPairs(db, U, [
      { hevyTemplateId: "T-BENCH", exerciseId: bench },
      { hevyTemplateId: "T-ROW", exerciseId: row, hevyType: "reps_only", measureRule: "calories_as_reps" },
      { hevyTemplateId: "T-WARM", role: "warmup_placeholder" },
    ]);
  });

  const repo = (seams?: Parameters<typeof createHevyImportRepository>[1]) => createHevyImportRepository(db.prisma, seams);

  async function translate(w: HevyImportWorkout): Promise<ImportedWorkout> {
    const t = translateHevyWorkout(w, await loadContext(db.prisma, U, NOW));
    if (t.outcome !== "create") throw new Error(`fixture did not translate: ${t.outcome}`);
    return t.workout;
  }

  /** Warm-up section, bench in a superset with the row erg, then the row erg's calories. */
  const rich = (): HevyImportWorkout =>
    importWorkoutFixture({
      hevyWorkoutId: "H-RICH",
      title: "Push day",
      description: "Felt strong",
      tzOffsetMinutes: -300,
      startTime: "2026-09-10T10:00:00-05:00",
      endTime: "2026-09-10T11:00:00-05:00",
      exercises: [
        { exerciseTemplateId: "T-WARM", notes: "Warmup", supersetId: null, sets: [set({ reps: 10 })] },
        { exerciseTemplateId: "T-BENCH", notes: "elbows in", supersetId: 1, sets: [set({ weightKg: 60, reps: 5 }), set({ weightKg: 62.5, reps: 5, rpe: 8 })] },
        { exerciseTemplateId: "T-ROW", notes: null, supersetId: 1, sets: [set({ reps: 20 })] },
      ],
    });

  describe("19.1 AC17 — a created workout", () => {
    it("stores the workout, sections, exercises, sets, link and fingerprint field by field", async () => {
      const out = await repo().writeImportedWorkout(U, "H-RICH", await translate(rich()));
      expect(out.kind).toBe("created");
      const id = (out as { workoutId: string }).workoutId;

      const [w] = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT source, title, notes, started_at, ended_at, to_char(local_date,'YYYY-MM-DD') AS local_date, tz_offset_minutes,
                routine_id, routine_name_snapshot, planned_duration_s, client_generated_id IS NOT NULL AS has_cgid
         FROM workout WHERE id = $1::uuid`,
        id,
      );
      expect(w).toEqual({
        source: "hevy",
        title: "Push day",
        notes: "Felt strong",
        started_at: new Date("2026-09-10T15:00:00Z"),
        ended_at: new Date("2026-09-10T16:00:00Z"),
        local_date: "2026-09-10",
        tz_offset_minutes: -300,
        routine_id: null,
        routine_name_snapshot: null,
        planned_duration_s: null,
        has_cgid: true,
      });

      const sections = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id::text, position, name, added_in_workout FROM workout_section WHERE workout_id = $1::uuid ORDER BY position`,
        id,
      );
      expect(sections).toEqual([{ id: expect.any(String), position: 0, name: "Warm-up", added_in_workout: false }]);

      const exercises = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id::text, position, exercise_id::text, exercise_name_snapshot, modality_snapshot, notes, superset_group,
                section_id::text
         FROM workout_exercise WHERE workout_id = $1::uuid ORDER BY position`,
        id,
      );
      expect(exercises.map((e) => ({ ...e, id: null }))).toEqual([
        { id: null, position: 0, exercise_id: bench, exercise_name_snapshot: "Bench Press", modality_snapshot: "weight_reps", notes: "elbows in", superset_group: 1, section_id: sections[0]!.id },
        { id: null, position: 1, exercise_id: row, exercise_name_snapshot: "Row Erg", modality_snapshot: "calories", notes: null, superset_group: 1, section_id: sections[0]!.id },
      ]);

      const sets = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT we.position, s.set_number, s.set_type, s.reps, s.weight::float8 AS weight, s.weight_unit, s.distance_unit,
                s.calories, s.rpe::float8 AS rpe, s.is_complete, s.completed_at
         FROM set_entry s JOIN workout_exercise we ON we.id = s.workout_exercise_id
         WHERE we.workout_id = $1::uuid ORDER BY we.position, s.set_number`,
        id,
      );
      expect(sets).toEqual([
        { position: 0, set_number: 1, set_type: "working", reps: 5, weight: 60, weight_unit: "kg", distance_unit: null, calories: null, rpe: null, is_complete: true, completed_at: null },
        { position: 0, set_number: 2, set_type: "working", reps: 5, weight: 62.5, weight_unit: "kg", distance_unit: null, calories: null, rpe: 8, is_complete: true, completed_at: null },
        { position: 1, set_number: 1, set_type: "working", reps: null, weight: null, weight_unit: null, distance_unit: null, calories: 20, rpe: null, is_complete: true, completed_at: null },
      ]);

      const links = await db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT workout_id::text, hevy_workout_id, origin, synced_fingerprint, synced_at IS NOT NULL AS synced, claimed_at
         FROM hevy_link WHERE user_id = $1::uuid`,
        U,
      );
      const detail = await readWorkoutDetail(db.prisma, U, id);
      expect(links).toEqual([
        { workout_id: id, hevy_workout_id: "H-RICH", origin: "imported", synced_fingerprint: hevyFingerprint(fingerprintSourceOf(detail!)), synced: true, claimed_at: null },
      ]);
    });

    it("reads back through GET /v1/workouts/{id} and sits in History by start time", async () => {
      const early = await logWorkout(db, U, { startedAt: new Date("2026-09-09T10:00:00Z"), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 60 }] }] });
      const late = await logWorkout(db, U, { startedAt: new Date("2026-09-11T10:00:00Z"), exercises: [{ exerciseId: bench, sets: [{ reps: 5, weight: 60 }] }] });
      const out = await repo().writeImportedWorkout(U, "H-RICH", await translate(rich()));
      const id = (out as { workoutId: string }).workoutId;

      const res = await app.inject({ method: "GET", url: `/v1/workouts/${id}`, headers: AUTH });
      expect(res.statusCode).toBe(200);
      expect(WorkoutDetailSchema.safeParse(res.json()).success).toBe(true);
      expect(res.json()).toMatchObject({ source: "hevy" });

      const list = await app.inject({ method: "GET", url: "/v1/workouts", headers: AUTH });
      expect((list.json() as { items: { id: string }[] }).items.map((i) => i.id)).toEqual([late.workoutId, id, early.workoutId]);
    });
  });

  describe("19.1 AC18 — the finished-workout rules apply", () => {
    const corruptions: [string, (w: ImportedWorkout) => void][] = [
      ["a forbidden measure", (w) => void (w.exercises[1]!.sets[0]!.distance = 100)],
      ["a required measure null", (w) => void (w.exercises[0]!.sets[0]!.reps = null)],
      ["an inverted time", (w) => void (w.endedAt = "2026-09-10T14:00:00.000Z")],
      ["nine sections", (w) => void w.sections.push(...Array.from({ length: 8 }, (_, i) => ({ name: `S${i}`, notes: null })))],
      ["an exercise with no sets", (w) => void (w.exercises[1]!.sets = [])],
      ["no exercises", (w) => void (w.exercises = [])],
    ];
    it.each(corruptions)("%s is rejected with nothing written", async (_label, corrupt) => {
      const w = await translate(rich());
      corrupt(w);
      const before = await rowCounts(db);
      await expect(repo().writeImportedWorkout(U, "H-RICH", w)).resolves.toEqual({ kind: "rejected" });
      expect(await rowCounts(db)).toEqual(before);
    });

    it("an exercise retired between the translation and the write is rejected", async () => {
      const w = await translate(rich());
      await db.prisma.$executeRawUnsafe(`UPDATE exercise SET is_active = false WHERE id = $1::uuid`, row);
      const before = await rowCounts(db);
      await expect(repo().writeImportedWorkout(U, "H-RICH", w)).resolves.toEqual({ kind: "rejected" });
      expect(await rowCounts(db)).toEqual(before);
    });

    it("a CHECK the pure re-check does not cover (23514) is rejected", async () => {
      const w = await translate(rich());
      w.exercises[0]!.sets[0]!.setType = "bogus" as never;
      const before = await rowCounts(db);
      await expect(repo().writeImportedWorkout(U, "H-RICH", w)).resolves.toEqual({ kind: "rejected" });
      expect(await rowCounts(db)).toEqual(before);
    });
  });

  describe("19.1 AC19 — idempotent per Hevy workout id", () => {
    it("a second write of the same id is already_linked and writes nothing", async () => {
      const w = await translate(rich());
      expect((await repo().writeImportedWorkout(U, "H-RICH", w)).kind).toBe("created");
      const before = await rowCounts(db);
      await expect(repo().writeImportedWorkout(U, "H-RICH", w)).resolves.toEqual({ kind: "already_linked" });
      expect(await rowCounts(db)).toEqual(before);
    });

    it("two concurrent writes create one workout and leave no orphan rows", async () => {
      const w = await translate(rich());
      const outs = await Promise.all([repo().writeImportedWorkout(U, "H-RICH", w), repo().writeImportedWorkout(U, "H-RICH", w)]);
      expect(outs.map((o) => o.kind).sort()).toEqual(["already_linked", "created"]);
      expect(await rowCounts(db)).toMatchObject({ workout: 1, workout_section: 1, workout_exercise: 2, set_entry: 3, hevy_link: 1 });
    });
  });

  describe("19.1 AC24 — per-workout atomicity and resume", () => {
    it("a failure after the set insert rolls the workout back, and a retry creates it", async () => {
      const w = await translate(rich());
      const before = await rowCounts(db);
      const failing = repo({
        onWriteStep: (step) => {
          if (step === "sets") throw new Error("injected");
        },
      });
      await expect(failing.writeImportedWorkout(U, "H-RICH", w)).rejects.toThrow("injected");
      expect(await rowCounts(db)).toEqual(before);
      expect((await repo().writeImportedWorkout(U, "H-RICH", w)).kind).toBe("created");
    });

    it("the seam sees each write statement in order", async () => {
      const steps: string[] = [];
      await repo({ onWriteStep: (s) => void steps.push(s) }).writeImportedWorkout(U, "H-RICH", await translate(rich()));
      expect(steps).toEqual(["workout", "sections", "exercises", "sets", "link"]);
    });
  });

  describe("19.1 AC25 — the stale-records flag", () => {
    const stale = async () =>
      (await db.prisma.$queryRawUnsafe<{ records_stale: boolean }[]>(`SELECT records_stale FROM hevy_account WHERE user_id = $1::uuid`, U))[0]?.records_stale;

    it("a create inserts the row when absent and sets it when present", async () => {
      expect(await stale()).toBeUndefined();
      await repo().writeImportedWorkout(U, "H-1", await translate({ ...rich(), hevyWorkoutId: "H-1" }));
      expect(await stale()).toBe(true);
      await db.prisma.$executeRawUnsafe(`UPDATE hevy_account SET records_stale = false WHERE user_id = $1::uuid`, U);
      await repo().writeImportedWorkout(U, "H-2", await translate({ ...rich(), hevyWorkoutId: "H-2" }));
      expect(await stale()).toBe(true);
    });

    it("a rejected write leaves it unchanged", async () => {
      await db.prisma.$executeRawUnsafe(`INSERT INTO hevy_account (user_id, records_stale) VALUES ($1::uuid, false)`, U);
      const w = await translate(rich());
      w.endedAt = "2026-09-10T14:00:00.000Z";
      await repo().writeImportedWorkout(U, "H-RICH", w);
      expect(await stale()).toBe(false);
    });
  });

  describe("19.1 AC29 — units", () => {
    const one = () =>
      importWorkoutFixture({
        hevyWorkoutId: "H-UNIT",
        exercises: [{ exerciseTemplateId: "T-BENCH", notes: null, supersetId: null, sets: [set({ weightKg: 61.235, reps: 5 })] }],
      });
    const stored = async () =>
      (
        await db.prisma.$queryRawUnsafe<{ weight: string; weight_unit: string; weight_kg: string }[]>(
          `SELECT weight::text, weight_unit, weight_kg::text FROM set_entry`,
        )
      )[0];

    it("a kg user stores 61.2 kg", async () => {
      await repo().writeImportedWorkout(U, "H-UNIT", await translate(one()));
      expect(await stored()).toEqual({ weight: "61.200", weight_unit: "kg", weight_kg: "61.200" });
    });

    it("a lb user stores 135 lb with weight_kg 61.235", async () => {
      await db.prisma.$executeRawUnsafe(`UPDATE "user" SET unit_preference = 'lb' WHERE id = $1::uuid`, U);
      await repo().writeImportedWorkout(U, "H-UNIT", await translate(one()));
      expect(await stored()).toEqual({ weight: "135.000", weight_unit: "lb", weight_kg: "61.235" });
    });
  });

  describe("Minor 156 — a retire waits for an import's share lock", () => {
    let other: PrismaClient;
    beforeAll(() => {
      if (!shouldRunIntegration()) return;
      other = new PrismaClient({ datasourceUrl: db.url });
    });
    afterAll(async () => {
      await other?.$disconnect();
    });

    it("a retire that starts mid-write blocks until the import commits; the workout stores and the exercise ends retired", async () => {
      const w = await translate(rich());
      let retire: Promise<unknown> | null = null;
      let retiredMidWrite = false;
      const seamed = repo({
        onWriteStep: async (step) => {
          if (step !== "workout") return;
          // The usable check has run; a retire now must wait for this transaction.
          let done = false;
          retire = other.$executeRawUnsafe(`UPDATE exercise SET is_active = false WHERE id = $1::uuid`, row).then(() => {
            done = true;
          });
          await new Promise((r) => setTimeout(r, 400));
          retiredMidWrite = done;
        },
      });
      const out = await seamed.writeImportedWorkout(U, "H-RICH", w);
      await retire;
      expect(retiredMidWrite).toBe(false);
      expect(out.kind).toBe("created");
      const [ex] = await db.prisma.$queryRawUnsafe<{ is_active: boolean }[]>(`SELECT is_active FROM exercise WHERE id = $1::uuid`, row);
      expect(ex!.is_active).toBe(false);
      expect(await rowCounts(db)).toMatchObject({ workout: 1, workout_exercise: 2 });
    });

    it("a retire committed before the write is rejected with no workout row", async () => {
      const w = await translate(rich());
      await other.$executeRawUnsafe(`UPDATE exercise SET is_active = false WHERE id = $1::uuid`, row);
      await expect(repo().writeImportedWorkout(U, "H-RICH", w)).resolves.toEqual({ kind: "rejected" });
      expect(await rowCounts(db)).toMatchObject({ workout: 0 });
    });
  });

  describe("Minor 163 — one real flag write per batch", () => {
    const account = async () =>
      (
        await db.prisma.$queryRawUnsafe<{ records_stale: boolean; xmin: string; updated_at: Date }[]>(
          `SELECT records_stale, xmin::text AS xmin, updated_at FROM hevy_account WHERE user_id = $1::uuid`,
          U,
        )
      )[0];

    it("a batch of 3 creates writes the row once (the first create); finish still clears it", async () => {
      await db.prisma.$executeRawUnsafe(
        `INSERT INTO hevy_account (user_id, records_stale, updated_at) VALUES ($1::uuid, false, '2020-01-01T00:00:00Z')`,
        U,
      );
      const workouts = ["H-A", "H-B", "H-C"].map((id, i) =>
        importWorkoutFixture({ hevyWorkoutId: id, title: `Day ${i}`, startTime: `2026-09-1${i}T10:00:00Z`, endTime: `2026-09-1${i}T11:00:00Z` }),
      );
      const batch = await repo().importBatch(U, { dryRun: false, workouts }, NOW);
      expect(batch.results.map((r) => r.outcome)).toEqual(["create", "create", "create"]);

      // Each workout row carries its own transaction's id: the flag row must still carry the first one's.
      const xmins = await db.prisma.$queryRawUnsafe<{ xmin: string }[]>(`SELECT xmin::text AS xmin FROM workout ORDER BY started_at`);
      const after = await account();
      expect(after!.records_stale).toBe(true);
      expect(after!.xmin).toBe(xmins[0]!.xmin);
      expect(after!.updated_at.getTime()).toBeGreaterThan(Date.parse("2020-01-02T00:00:00Z"));

      await expect(repo().finishImport(U)).resolves.toMatchObject({ recomputed: true });
      expect((await account())!.records_stale).toBe(false);
    });
  });
});
