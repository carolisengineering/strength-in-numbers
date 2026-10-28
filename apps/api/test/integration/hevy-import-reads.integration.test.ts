import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { findCandidates, findLinks, loadContext } from "../../src/repositories/hevy-import.prisma.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertLink, seedPairs } from "./hevy-import-helpers.js";
import { logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const at = (iso: string) => new Date(iso);

/** Spec 19.1 Phase B — the import's per-request reads (§6.1, §6.3). */
describe.skipIf(!shouldRunIntegration())("Spec 19.1 — Hevy import reads (real Postgres)", () => {
  let db: IntegrationDb;
  let a: string;
  let b: string;
  let bench: string;

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
    a = await insertUser(db);
    b = await insertUser(db);
    bench = await insertExercise(db, { name: "Bench Press", modality: "weight_reps" });
  });

  async function workoutAt(userId: string, iso: string, opts: { finish?: "raw" | "none"; exerciseId?: string } = {}) {
    const { workoutId } = await logWorkout(db, userId, {
      startedAt: at(iso),
      finish: opts.finish ?? "raw",
      exercises: [{ exerciseId: opts.exerciseId ?? bench, sets: [{ reps: 5, weight: 60 }] }],
    });
    return workoutId;
  }

  describe("19.1 AC20 — link lookup", () => {
    it("returns each origin and a tombstone, and never another user's link", async () => {
      const w1 = await workoutAt(a, "2026-09-01T10:00:00Z");
      const w2 = await workoutAt(a, "2026-09-02T10:00:00Z");
      const w3 = await workoutAt(a, "2026-09-03T10:00:00Z");
      await insertLink(db, { userId: a, workoutId: w1, hevyWorkoutId: "H-SENT", origin: "sent" });
      await insertLink(db, { userId: a, workoutId: w2, hevyWorkoutId: "H-IMP", origin: "imported" });
      await insertLink(db, { userId: a, workoutId: w3, hevyWorkoutId: "H-MATCH", origin: "matched" });
      await insertLink(db, { userId: a, workoutId: null, hevyWorkoutId: "H-GONE", origin: "imported" });
      const bw = await workoutAt(b, "2026-09-04T10:00:00Z");
      await insertLink(db, { userId: b, workoutId: bw, hevyWorkoutId: "H-B", origin: "imported" });

      const links = await findLinks(db.prisma, a, ["H-SENT", "H-IMP", "H-MATCH", "H-GONE", "H-B", "H-NONE"]);
      expect(Object.fromEntries(links)).toEqual({
        "H-SENT": { workoutId: w1, origin: "sent" },
        "H-IMP": { workoutId: w2, origin: "imported" },
        "H-MATCH": { workoutId: w3, origin: "matched" },
        "H-GONE": { workoutId: null, origin: "imported" },
      });
    });

    it("an empty id list reads nothing", async () => {
      expect((await findLinks(db.prisma, a, [])).size).toBe(0);
    });
  });

  describe("19.1 AC21 — the candidate matrix", () => {
    it("finished workouts within an hour on the same day; never live, linked, another user's, 61 min away or another day", async () => {
      const plus59 = await workoutAt(a, "2026-09-10T10:59:00Z");
      const minus59 = await workoutAt(a, "2026-09-10T09:01:00Z");
      await workoutAt(a, "2026-09-10T11:01:00Z");
      await workoutAt(a, "2026-09-10T10:10:00Z", { finish: "none" });
      const linked = await workoutAt(a, "2026-09-10T10:05:00Z");
      await insertLink(db, { userId: a, workoutId: linked, hevyWorkoutId: "H-OTHER", origin: "sent" });
      await workoutAt(b, "2026-09-10T10:00:00Z");
      const otherDay = await workoutAt(a, "2026-09-10T10:20:00Z");
      await db.prisma.$executeRawUnsafe(`UPDATE "workout" SET local_date = '2026-09-11' WHERE id = $1::uuid`, otherDay);

      const rows = await findCandidates(db.prisma, a, "2026-09-10", "2026-09-10T10:00:00.000Z");
      expect(rows.map((r) => r.id).sort()).toEqual([plus59, minus59].sort());
      const row = rows.find((r) => r.id === plus59)!;
      expect(row).toEqual({ id: plus59, localDate: "2026-09-10", startedAt: "2026-09-10T10:59:00.000000Z", title: null, rootIds: [bench] });
    });

    it("a workout using a fork returns the built-in's id as its root", async () => {
      const fork = await insertExercise(db, { ownerUserId: a, forkedFrom: bench, name: "My bench" });
      const w = await workoutAt(a, "2026-09-10T10:00:00Z", { exerciseId: fork });
      const rows = await findCandidates(db.prisma, a, "2026-09-10", "2026-09-10T10:00:00Z");
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ id: w, rootIds: [bench] });
    });
  });

  describe("19.1 AC22 — the context", () => {
    it("loads pairs, the exercises they name with roots and active flags, and the unit", async () => {
      const fork = await insertExercise(db, { ownerUserId: a, forkedFrom: bench, name: "My bench" });
      const gone = await insertExercise(db, { ownerUserId: a, name: "Old curl", isActive: false });
      await seedPairs(db, a, [
        { hevyTemplateId: "T-FORK", exerciseId: fork },
        { hevyTemplateId: "T-GONE", exerciseId: gone },
        { hevyTemplateId: "T-SKIP", role: "skip" },
        { hevyTemplateId: "T-WARM", role: "warmup_placeholder" },
      ]);
      await seedPairs(db, b, [{ hevyTemplateId: "T-B", exerciseId: bench }]);
      await db.prisma.$executeRawUnsafe(`UPDATE "user" SET unit_preference = 'lb' WHERE id = $1::uuid`, a);
      const now = new Date("2026-10-28T12:00:00Z");

      const ctx = await loadContext(db.prisma, a, now);
      expect([...ctx.pairs.keys()].sort()).toEqual(["T-FORK", "T-GONE", "T-SKIP", "T-WARM"]);
      expect(ctx.pairs.get("T-FORK")).toMatchObject({ role: "exercise", exerciseId: fork, hevyType: "weight_reps" });
      expect(Object.fromEntries(ctx.exercises)).toEqual({
        [fork]: { name: "My bench", modality: "weight_reps", active: true, rootId: bench },
        [gone]: { name: "Old curl", modality: "weight_reps", active: false, rootId: gone },
      });
      expect(ctx.unit).toBe("lb");
      expect(ctx.now).toBe(now);
    });
  });
});
