import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { HevyImportResult, HevyImportWorkout } from "@sin/core";
import { fingerprintSourceOf, hevyFingerprint } from "../../src/hevy/fingerprint.js";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { readWorkoutDetail } from "../../src/repositories/workout.prisma.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { importWorkoutFixture, insertLink, rowCounts, seedPairs } from "./hevy-import-helpers.js";
import { logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const NOW = new Date("2026-10-28T12:00:00Z");
type Set = HevyImportWorkout["exercises"][number]["sets"][number];
const set = (over: Partial<Set> = {}): Set => ({
  type: "normal",
  weightKg: null,
  reps: null,
  distanceMeters: null,
  durationSeconds: null,
  rpe: null,
  customMetric: null,
  ...over,
});
const bench = (sets: Set[] = [set({ weightKg: 60, reps: 5 })]) => ({ exerciseTemplateId: "T-BENCH", notes: null, supersetId: null, sets });
const withoutIds = (results: HevyImportResult[]) => results.map((r) => ({ ...r, workoutId: null }));

/** Spec 19.1 §6.1 — the batch: links, translation, duplicates, dry run, write. */
describe.skipIf(!shouldRunIntegration())("Spec 19.1 — Hevy import batch (real Postgres)", () => {
  let db: IntegrationDb;
  let u: string;
  let benchId: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  beforeEach(async () => {
    if (!db) return;
    await db.prisma.$executeRawUnsafe(TRUNCATE_ALL);
    u = await insertUser(db);
    benchId = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
    await seedPairs(db, u, [
      { hevyTemplateId: "T-BENCH", exerciseId: benchId },
      { hevyTemplateId: "T-SKIP", role: "skip" },
      { hevyTemplateId: "T-WARM", role: "warmup_placeholder" },
    ]);
  });

  const repo = (seams?: Parameters<typeof createHevyImportRepository>[1]) => createHevyImportRepository(db.prisma, seams);
  const run = (workouts: HevyImportWorkout[], dryRun = false, seams?: Parameters<typeof createHevyImportRepository>[1]) =>
    repo(seams).importBatch(u, { dryRun, workouts }, NOW);
  const stale = async () =>
    (await db.prisma.$queryRawUnsafe<{ records_stale: boolean }[]>(`SELECT records_stale FROM hevy_account WHERE user_id = $1::uuid`, u))[0]
      ?.records_stale ?? null;

  /** A finished SIN workout (bench) at the given start, optionally titled. */
  async function sinWorkout(iso: string, title: string | null = "Push day") {
    const { workoutId } = await logWorkout(db, u, { startedAt: new Date(iso), exercises: [{ exerciseId: benchId, sets: [{ reps: 5, weight: 60 }] }] });
    await db.prisma.$executeRawUnsafe(`UPDATE workout SET title = $2 WHERE id = $1::uuid`, workoutId, title);
    return workoutId;
  }

  /** One workout per outcome the dry run can reach. */
  async function mixedBatch(): Promise<HevyImportWorkout[]> {
    await sinWorkout("2026-09-12T10:00:00Z", "Leg day");
    const done = await sinWorkout("2026-09-01T10:00:00Z");
    await insertLink(db, { userId: u, workoutId: done, hevyWorkoutId: "H-DONE", origin: "imported" });
    return [
      importWorkoutFixture({ hevyWorkoutId: "H-NEW" }),
      importWorkoutFixture({ hevyWorkoutId: "H-DUP", title: "Leg day", startTime: "2026-09-12T10:20:00Z", endTime: "2026-09-12T11:00:00Z" }),
      importWorkoutFixture({ hevyWorkoutId: "H-UNPAIRED", exercises: [{ exerciseTemplateId: "T-NOPE", notes: null, supersetId: null, sets: [set({ reps: 5 })] }] }),
      importWorkoutFixture({ hevyWorkoutId: "H-NOSETS", exercises: [bench([set({ weightKg: 60 })])] }),
      importWorkoutFixture({ hevyWorkoutId: "H-TIME", startTime: "2026-09-10T12:00:00Z", endTime: "2026-09-10T11:00:00Z" }),
      importWorkoutFixture({ hevyWorkoutId: "H-DONE" }),
    ];
  }

  describe("19.1 AC16 — a dry run writes nothing", () => {
    it("leaves every count and the flag unchanged, and returns what the real run returns", async () => {
      const batch = await mixedBatch();
      const before = await rowCounts(db);
      const dry = await run(batch, true);
      expect(await rowCounts(db)).toEqual(before);
      expect(await stale()).toBeNull();
      expect(dry.results.map((r) => r.outcome)).toEqual(["create", "duplicate", "unpaired", "no_usable_sets", "time_invalid", "already_imported"]);
      expect(dry.results.every((r) => r.workoutId === null)).toBe(true);

      const real = await run(batch);
      expect(withoutIds(real.results)).toEqual(withoutIds(dry.results));
      expect(real.results[0]!.workoutId).not.toBeNull();
      expect(await stale()).toBe(true);
    });
  });

  describe("19.1 AC20 — links decide skips", () => {
    it("each origin and a tombstone answer by the link, even with an unpaired exercise", async () => {
      const ids = await Promise.all(["2026-09-01", "2026-09-02", "2026-09-03"].map((d) => sinWorkout(`${d}T08:00:00Z`)));
      await insertLink(db, { userId: u, workoutId: ids[0]!, hevyWorkoutId: "H-S", origin: "sent" });
      await insertLink(db, { userId: u, workoutId: ids[1]!, hevyWorkoutId: "H-I", origin: "imported" });
      await insertLink(db, { userId: u, workoutId: ids[2]!, hevyWorkoutId: "H-M", origin: "matched" });
      await insertLink(db, { userId: u, workoutId: null, hevyWorkoutId: "H-T", origin: "imported" });
      const unpaired = [{ exerciseTemplateId: "T-NOPE", notes: null, supersetId: null, sets: [set({ reps: 5 })] }];
      const before = await rowCounts(db);
      const out = await run(["H-S", "H-I", "H-M", "H-T"].map((id) => importWorkoutFixture({ hevyWorkoutId: id, exercises: unpaired })));
      expect(out.results.map((r) => [r.outcome, r.unpaired])).toEqual([
        ["sent_from_sin", []],
        ["already_imported", []],
        ["already_matched", []],
        ["deleted_in_sin", []],
      ]);
      expect(await rowCounts(db)).toEqual(before);
    });
  });

  describe("19.1 AC21 — duplicate matching", () => {
    it("a match writes a matched link with the SIN workout's fingerprint and no new workout", async () => {
      const sin = await sinWorkout("2026-09-10T10:30:00Z");
      const before = await rowCounts(db);
      const out = await run([importWorkoutFixture({ hevyWorkoutId: "H-1" })]);
      expect(out.results[0]).toMatchObject({ outcome: "duplicate", matchedWorkoutId: sin, workoutId: null, exerciseCount: 0, setCount: 0 });
      expect(await rowCounts(db)).toEqual({ ...before, hevy_link: before.hevy_link + 1 });
      const [link] = await db.prisma.$queryRawUnsafe<{ workout_id: string; origin: string; synced_fingerprint: string }[]>(
        `SELECT workout_id::text, origin, synced_fingerprint FROM hevy_link WHERE hevy_workout_id = 'H-1'`,
      );
      const detail = await readWorkoutDetail(db.prisma, u, sin);
      expect(link).toEqual({ workout_id: sin, origin: "matched", synced_fingerprint: hevyFingerprint(fingerprintSourceOf(detail!)) });
      expect(await stale()).toBeNull();
    });

    it("the nearer start wins, then the lower id", async () => {
      await sinWorkout("2026-09-10T10:40:00Z");
      const near = await sinWorkout("2026-09-10T09:50:00Z");
      expect((await run([importWorkoutFixture({ hevyWorkoutId: "H-1" })], true)).results[0]!.matchedWorkoutId).toBe(near);

      const tieA = await sinWorkout("2026-09-20T09:30:00Z");
      const tieB = await sinWorkout("2026-09-20T10:30:00Z");
      const h = importWorkoutFixture({ hevyWorkoutId: "H-2", startTime: "2026-09-20T10:00:00Z", endTime: "2026-09-20T11:00:00Z" });
      expect((await run([h], true)).results[0]!.matchedWorkoutId).toBe([tieA, tieB].sort()[0]);
    });

    it("two Hevy workouts on one SIN workout in one request: the second creates, dry and real alike", async () => {
      const sin = await sinWorkout("2026-09-10T10:00:00Z");
      const batch = [importWorkoutFixture({ hevyWorkoutId: "H-A" }), importWorkoutFixture({ hevyWorkoutId: "H-B" })];
      const dry = await run(batch, true);
      expect(dry.results.map((r) => [r.outcome, r.matchedWorkoutId])).toEqual([["duplicate", sin], ["create", null]]);
      const real = await run(batch);
      expect(withoutIds(real.results)).toEqual(withoutIds(dry.results));
    });

    it("in two separate requests the second also creates", async () => {
      await sinWorkout("2026-09-10T10:00:00Z");
      expect((await run([importWorkoutFixture({ hevyWorkoutId: "H-A" })])).results[0]!.outcome).toBe("duplicate");
      expect((await run([importWorkoutFixture({ hevyWorkoutId: "H-B" })])).results[0]!.outcome).toBe("create");
    });

    it("a candidate holding a stale claim-only link is not a candidate: dry and real runs agree", async () => {
      const sin = await sinWorkout("2026-09-10T10:00:00Z");
      await insertLink(db, { userId: u, workoutId: sin, hevyWorkoutId: null, origin: "sent" });
      const batch = [importWorkoutFixture({ hevyWorkoutId: "H-A" })];
      const dry = await run(batch, true);
      const real = await run(batch);
      expect(dry.results.map((r) => r.outcome)).toEqual(["create"]);
      expect(withoutIds(real.results)).toEqual(withoutIds(dry.results));
    });

    it("a delete of the matched workout during the match drops it and creates, never a 500", async () => {
      const sin = await sinWorkout("2026-09-10T10:00:00Z");
      const out = await run([importWorkoutFixture({ hevyWorkoutId: "H-A" })], false, {
        onWriteStep: async (step) => {
          if (step === "match") await db.prisma.$executeRawUnsafe(`DELETE FROM workout WHERE id = $1::uuid`, sin);
        },
      });
      expect(out.results[0]!.outcome).toBe("create");
    });

    it("a Send that links the candidate before the match insert drops it and creates, never a 500", async () => {
      const sin = await sinWorkout("2026-09-10T10:00:00Z");
      const out = await run([importWorkoutFixture({ hevyWorkoutId: "H-A" })], false, {
        onWriteStep: async (step) => {
          if (step === "match") await insertLink(db, { userId: u, workoutId: sin, hevyWorkoutId: null, origin: "sent" });
        },
      });
      expect(out.results[0]!.outcome).toBe("create");
      expect(out.results[0]!.workoutId).not.toBeNull();
    });
  });

  describe("19.1 AC22 — unpaired", () => {
    it("writes nothing, and imports once the mapping gains the pair", async () => {
      const w = importWorkoutFixture({
        hevyWorkoutId: "H-U",
        exercises: [bench(), { exerciseTemplateId: "T-CURL", notes: null, supersetId: null, sets: [set({ weightKg: 10, reps: 10 })] }],
      });
      const before = await rowCounts(db);
      const first = await run([w, importWorkoutFixture({ hevyWorkoutId: "H-OK", startTime: "2026-09-15T10:00:00Z", endTime: "2026-09-15T11:00:00Z" })]);
      expect(first.results.map((r) => [r.outcome, r.unpaired])).toEqual([["unpaired", ["T-CURL"]], ["create", []]]);
      expect((await rowCounts(db)).workout).toBe(before.workout + 1);

      const curl = await insertExercise(db, { name: "Curl", modality: "weight_reps" });
      await seedPairs(db, u, [{ hevyTemplateId: "T-CURL", exerciseId: curl }]);
      expect((await run([w])).results[0]!.outcome).toBe("create");
    });
  });

  describe("19.1 AC23 — everything dropped is reported", () => {
    it("counts every kind of drop and notice, still creates, and the set totals add up", async () => {
      const w = importWorkoutFixture({
        hevyWorkoutId: "H-DROPS",
        exercises: [
          { exerciseTemplateId: "T-WARM", notes: null, supersetId: null, sets: [set({ reps: 10 }), set({ reps: 10 })] },
          { exerciseTemplateId: "T-SKIP", notes: null, supersetId: null, sets: [set({ reps: 1 }), set({ reps: 1 }), set({ reps: 1 })] },
          bench([
            set({ weightKg: 60, reps: 5, customMetric: 3 }),
            set({ weightKg: 60 }),
            set({ weightKg: 60, reps: 5, distanceMeters: 100 }),
            set({ weightKg: 60, reps: 5.5 }),
          ]),
          bench([set({ weightKg: 60 })]),
        ],
      });
      const out = await run([w]);
      const r = out.results[0]!;
      expect(r.outcome).toBe("create");
      expect(r.drops).toEqual([
        { code: "exercise_skipped", count: 3 },
        { code: "exercise_no_sets", count: 1 },
        { code: "set_missing_measure", count: 2 },
        { code: "set_forbidden_measure", count: 1 },
        { code: "set_out_of_range", count: 1 },
      ]);
      expect(r.notices).toEqual(expect.arrayContaining([
        { code: "custom_metric_ignored", count: 1 },
        { code: "placeholder_sets_ignored", count: 2 },
      ]));
      expect(r).toMatchObject({ exerciseCount: 1, setCount: 1 });
      // 10 received, 2 placeholder sets ignored; exercise_no_sets counts an exercise, not a set (deferred minor 149).
      expect(out.setsCreated).toBe(1);
      expect(out.setsDropped).toBe(7);
      expect(out.setsCreated + out.setsDropped).toBe(10 - 2);
    });
  });

  describe("19.1 AC19 — one Hevy id twice in a batch", () => {
    it("creates the first and answers already_imported for the second, dry and real alike", async () => {
      const w = importWorkoutFixture({ hevyWorkoutId: "H-TWICE" });
      const dry = await run([w, w], true);
      expect(dry.results.map((r) => r.outcome)).toEqual(["create", "already_imported"]);
      const real = await run([w, w]);
      expect(withoutIds(real.results)).toEqual(withoutIds(dry.results));
      expect((await rowCounts(db)).workout).toBe(1);
    });

    it("sending the same batch again writes nothing", async () => {
      const batch = [importWorkoutFixture({ hevyWorkoutId: "H-1" }), importWorkoutFixture({ hevyWorkoutId: "H-2", startTime: "2026-09-15T10:00:00Z", endTime: "2026-09-15T11:00:00Z" })];
      await run(batch);
      const before = await rowCounts(db);
      expect((await run(batch)).results.map((r) => r.outcome)).toEqual(["already_imported", "already_imported"]);
      expect(await rowCounts(db)).toEqual(before);
    });

    it("two concurrent identical batches create each workout once", async () => {
      const batch = [importWorkoutFixture({ hevyWorkoutId: "H-1" }), importWorkoutFixture({ hevyWorkoutId: "H-2", startTime: "2026-09-15T10:00:00Z", endTime: "2026-09-15T11:00:00Z" })];
      const [a, b] = await Promise.all([run(batch), run(batch)]);
      for (const i of [0, 1]) expect([a.results[i]!.outcome, b.results[i]!.outcome].sort()).toEqual(["already_imported", "create"]);
      expect(await rowCounts(db)).toMatchObject({ workout: 2, hevy_link: 2 });
    });
  });
});
