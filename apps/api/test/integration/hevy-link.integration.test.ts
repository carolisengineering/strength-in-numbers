import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createHevyImportRepository } from "../../src/repositories/hevy-import.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { logWorkout, TRUNCATE_ALL } from "./records-helpers.js";

const A_ID = "0192a1b2-0000-7000-8000-0000000000aa";
const B_ID = "0192a1b2-0000-7000-8000-0000000000bb";
const A = { authorization: "Bearer a" };
const FP = /^v1:[0-9a-f]{64}$/;

/** Spec 19.0 AC26–AC31, AC37 — Hevy links against a real Postgres. */
describe.skipIf(!shouldRunIntegration())("Spec 19.0 Phase B — Hevy links (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  const lines: Record<string, unknown>[] = [];
  let ex: string;
  let ex2: string;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    const logger: FastifyBaseLogger = pino({ level: "info" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    app = await buildApp({
      config: { ...testConfig(), hevyEnabledUserIds: Object.freeze(new Set([A_ID, B_ID])) },
      logger,
      checkReadiness: () => checkDatabaseReady(db.prisma),
      tokenVerifier: fakeVerifier((token) => authContext({ authSub: `auth0|${token === "a" ? A_ID : B_ID}` })),
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
    await insertUser(db, { id: A_ID });
    await insertUser(db, { id: B_ID });
    ex = await insertExercise(db, { ownerUserId: A_ID, modality: "weight_reps" });
    ex2 = await insertExercise(db, { ownerUserId: A_ID, modality: "weight_reps" });
    lines.length = 0;
  });

  async function finished(userId = A_ID, finish: "raw" | "none" = "raw") {
    const { workoutId, setIds } = await logWorkout(db, userId, {
      startedAt: new Date(Date.now() - 3 * 3_600_000),
      finish,
      exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 60 }, { reps: 5, weight: 60 }] }],
    });
    const we = await db.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM workout_exercise WHERE workout_id = $1::uuid`, workoutId);
    return { workoutId, setIds: setIds[0]!, weId: we[0]!.id };
  }
  const url = (w: string) => `/v1/workouts/${w}/hevy-link`;
  const state = async (w: string) => (await app.inject({ method: "GET", url: url(w), headers: A })).json() as { state: string; hevyWorkoutId: string | null; origin: string | null; syncedAt: string | null };
  const begin = (w: string, payload?: object) => app.inject({ method: "POST", url: url(w), headers: A, ...(payload ? { payload } : {}) });
  const complete = (w: string, hevyWorkoutId: string, fingerprint: string) => app.inject({ method: "PUT", url: url(w), headers: A, payload: { hevyWorkoutId, fingerprint } });
  const release = (w: string) => app.inject({ method: "DELETE", url: url(w), headers: A });
  async function send(w: string, hevyId = "H1"): Promise<void> {
    const b = await begin(w);
    expect(b.statusCode).toBe(200);
    expect((await complete(w, hevyId, (b.json() as { fingerprint: string }).fingerprint)).statusCode).toBe(200);
  }
  /** Polls until a request's statement (not this poller's) is waiting on a lock. */
  async function waitForLockWait(): Promise<void> {
    for (let i = 0; i <= 200; i++) {
      const rows = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query NOT ILIKE '%pg_stat_activity%'`,
      );
      if (rows[0]!.n >= 1) return;
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error("the request never waited on a lock");
  }
  const age = (w: string) => db.prisma.$executeRawUnsafe(`UPDATE hevy_link SET claimed_at = now() - interval '121 seconds' WHERE workout_id = $1::uuid`, w);

  describe("19.0 AC26 — read", () => {
    it("no row is none; no-store", async () => {
      const { workoutId } = await finished();
      const res = await app.inject({ method: "GET", url: url(workoutId), headers: A });
      expect(res.json()).toEqual({ state: "none", hevyWorkoutId: null, origin: null, syncedAt: null });
      expect(res.headers["cache-control"]).toBe("no-store");
    });

    it("a live workout is none", async () => {
      const { workoutId } = await finished(A_ID, "none");
      expect((await state(workoutId)).state).toBe("none");
    });

    it("another user's, an absent, a malformed and a deleted workout are 404", async () => {
      const { workoutId: theirs } = await finished(B_ID);
      const { workoutId: gone } = await finished();
      await app.inject({ method: "DELETE", url: `/v1/workouts/${gone}`, headers: A });
      for (const w of [theirs, "0192a1b2-0000-7000-8000-000000009999", "abc", gone]) {
        expect((await app.inject({ method: "GET", url: url(w), headers: A })).statusCode, w).toBe(404);
      }
    });
  });

  describe("Minor 145 — a delete right after a complete doesn't turn its answer into a 404", () => {
    it("the complete still answers its linked state", async () => {
      const { workoutId } = await finished();
      const fp = ((await begin(workoutId)).json() as { fingerprint: string }).fingerprint;
      // The repository's client, with a delete landing the moment its transaction commits: a read of the answer
      // after the transaction would find no workout.
      let deleted = 0;
      const hooked = new Proxy(db.prisma, {
        get(target, prop, receiver) {
          if (prop === "$transaction") {
            return async (...args: Parameters<typeof target.$transaction>) => {
              const out = await (target.$transaction as (...a: unknown[]) => Promise<unknown>)(...args);
              const res = await app.inject({ method: "DELETE", url: `/v1/workouts/${workoutId}`, headers: A });
              if (res.statusCode === 204) deleted++;
              return out;
            };
          }
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const answer = await createHevyRepository(hooked).completeLink(A_ID, workoutId, { hevyWorkoutId: "H145", fingerprint: fp });
      expect(deleted).toBe(1);
      expect(answer).toMatchObject({ state: "sent", hevyWorkoutId: "H145", origin: "sent" });
      const tomb = await db.prisma.$queryRawUnsafe<{ workout_id: string | null }[]>(`SELECT workout_id FROM hevy_link WHERE hevy_workout_id = 'H145'`);
      expect(tomb).toEqual([{ workout_id: null }]);
    });
  });

  describe("deferred minor 140 — a delete that lands while a complete or release waits", () => {
    it("the complete answers 404, not hevy-no-claim", async () => {
      const { workoutId } = await finished();
      const b = await begin(workoutId);
      const fp = (b.json() as { fingerprint: string }).fingerprint;
      let release!: () => void;
      const released = new Promise<void>((r) => (release = r));
      let held!: () => void;
      const heldP = new Promise<void>((r) => (held = r));
      // The statements deleteWorkout runs, held open: the claim-only link row, then the workout.
      const deleter = db.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SELECT 1 FROM workout WHERE id = $1::uuid FOR UPDATE`, workoutId);
          await tx.$executeRawUnsafe(`DELETE FROM hevy_link WHERE workout_id = $1::uuid AND hevy_workout_id IS NULL`, workoutId);
          await tx.$executeRawUnsafe(`DELETE FROM workout WHERE id = $1::uuid`, workoutId);
          held();
          await released;
        },
        { timeout: 30_000 },
      );
      await heldP;
      const completeP = complete(workoutId, "H1", fp);
      try {
        await waitForLockWait();
      } finally {
        release();
        await deleter;
      }
      expect((await completeP).statusCode).toBe(404);
    }, 30_000);

    it("a release answers 404 and leaves no claim on the tombstone", async () => {
      const { workoutId } = await finished();
      await send(workoutId, "H5");
      expect((await begin(workoutId)).statusCode).toBe(200);
      let release_!: () => void;
      const released = new Promise<void>((r) => (release_ = r));
      let held!: () => void;
      const heldP = new Promise<void>((r) => (held = r));
      const deleter = db.prisma.$transaction(
        async (tx) => {
          await tx.$executeRawUnsafe(`SELECT 1 FROM workout WHERE id = $1::uuid FOR UPDATE`, workoutId);
          await tx.$executeRawUnsafe(`DELETE FROM workout WHERE id = $1::uuid`, workoutId);
          held();
          await released;
        },
        { timeout: 30_000 },
      );
      await heldP;
      const releaseP = release(workoutId);
      try {
        await waitForLockWait();
      } finally {
        release_();
        await deleter;
      }
      expect((await releaseP).statusCode).toBe(404);
      const tomb = await db.prisma.$queryRawUnsafe<{ claimed: boolean }[]>(`SELECT claimed_at IS NOT NULL AS claimed FROM hevy_link WHERE hevy_workout_id = 'H5'`);
      expect(tomb).toEqual([{ claimed: true }]);
    }, 30_000);
  });

  describe("19.0 AC27 — begin", () => {
    it("the first begin claims (create); a second is 409; an aged claim is taken over", async () => {
      const { workoutId } = await finished();
      const first = await begin(workoutId);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toEqual({ mode: "create", hevyWorkoutId: null, staleClaim: false, fingerprint: expect.stringMatching(FP) });
      expect((await state(workoutId)).state).toBe("sending");
      const second = await begin(workoutId);
      expect(second.statusCode).toBe(409);
      expect(second.json()).toMatchObject({ type: expect.stringContaining("hevy-send-in-progress") });
      await age(workoutId);
      expect((await state(workoutId)).state).toBe("none");
      expect((await begin(workoutId)).json()).toMatchObject({ mode: "create", staleClaim: true });
    });

    it("a live workout is 409 hevy-workout-not-finished", async () => {
      const { workoutId } = await finished(A_ID, "none");
      const res = await begin(workoutId);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: expect.stringContaining("hevy-workout-not-finished") });
    });

    it("a linked workout begins in update mode with the stored id; a second begin is 409; relink is create", async () => {
      const { workoutId } = await finished();
      await send(workoutId, "H7");
      expect((await begin(workoutId)).json()).toMatchObject({ mode: "update", hevyWorkoutId: "H7", staleClaim: false });
      expect((await begin(workoutId)).statusCode).toBe(409);
      await release(workoutId);
      expect((await begin(workoutId, { relink: true })).json()).toMatchObject({ mode: "create", hevyWorkoutId: null });
    });

    it("relink on an unlinked workout is a plain begin", async () => {
      const { workoutId } = await finished();
      expect((await begin(workoutId, { relink: true })).json()).toMatchObject({ mode: "create", hevyWorkoutId: null, staleClaim: false });
    });
  });

  describe("19.0 AC28 — complete", () => {
    it("with no claim is 409 hevy-no-claim", async () => {
      const { workoutId } = await finished();
      const res = await complete(workoutId, "H1", `v1:${"a".repeat(64)}`);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: expect.stringContaining("hevy-no-claim") });
    });

    it("records the link; a replay is 200 with the same result", async () => {
      const { workoutId } = await finished();
      const fp = ((await begin(workoutId)).json() as { fingerprint: string }).fingerprint;
      const first = await complete(workoutId, "H1", fp);
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ state: "sent", hevyWorkoutId: "H1", origin: "sent", syncedAt: expect.any(String) });
      const replay = await complete(workoutId, "H1", fp);
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toEqual(first.json());
    });

    it("Review Focus 5: a different id on a linked workout is hevy-link-conflict; an id held elsewhere (or by a tombstone) is hevy-id-in-use", async () => {
      const { workoutId: w1 } = await finished();
      const { workoutId: w2 } = await finished();
      await send(w1, "H1");
      const fp = ((await begin(w1)).json() as { fingerprint: string }).fingerprint;
      const conflict = await complete(w1, "H2", fp);
      expect(conflict.json()).toMatchObject({ type: expect.stringContaining("hevy-link-conflict") });
      await release(w1);
      const fp2 = ((await begin(w2)).json() as { fingerprint: string }).fingerprint;
      expect((await complete(w2, "H1", fp2)).json()).toMatchObject({ type: expect.stringContaining("hevy-id-in-use") });
      expect((await state(w1)).hevyWorkoutId).toBe("H1");
      await app.inject({ method: "DELETE", url: `/v1/workouts/${w1}`, headers: A });
      expect((await complete(w2, "H1", fp2)).json()).toMatchObject({ type: expect.stringContaining("hevy-id-in-use") });
    });

    it("final review I1: a stale tab completing a different id on a linked workout with no claim is hevy-link-conflict, not hevy-no-claim", async () => {
      const { workoutId } = await finished();
      const stale = ((await begin(workoutId)).json() as { fingerprint: string }).fingerprint;
      await age(workoutId);
      await send(workoutId, "H2"); // the newer tab took the claim over and finished
      const res = await complete(workoutId, "H1", stale);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ type: expect.stringContaining("hevy-link-conflict") });
      expect((await state(workoutId)).hevyWorkoutId).toBe("H2");
    });

    it("a fingerprint that is not well formed is 422", async () => {
      const { workoutId } = await finished();
      await begin(workoutId);
      expect((await complete(workoutId, "H1", "v2:abc")).statusCode).toBe(422);
    });
  });

  describe("19.0 AC29 — changed since sent", () => {
    type Edit = (w: Awaited<ReturnType<typeof finished>>) => Promise<{ statusCode: number }>;
    const changes: [string, Edit][] = [
      ["a set weight", (w) => app.inject({ method: "PATCH", url: `/v1/sets/${w.setIds[0]}`, headers: A, payload: { weight: 62.5 } })],
      ["a new set", (w) => app.inject({ method: "POST", url: `/v1/workout-exercises/${w.weId}/sets`, headers: A, payload: { reps: 3, weight: 70, weightUnit: "kg" } })],
      ["a deleted set", (w) => app.inject({ method: "DELETE", url: `/v1/sets/${w.setIds[1]}`, headers: A })],
      ["an added exercise", (w) => app.inject({ method: "POST", url: `/v1/workouts/${w.workoutId}/exercises`, headers: A, payload: { exerciseId: ex2 } })],
      ["the title", (w) => app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { title: "Renamed" } })],
      ["a superset", (w) => app.inject({ method: "PATCH", url: `/v1/workout-exercises/${w.weId}`, headers: A, payload: { supersetGroup: 1 } })],
      [
        "Review Focus 3: Change Time (start)",
        (w) => app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { startedAt: new Date(Date.now() - 5 * 3_600_000).toISOString(), tzOffsetMinutes: 0 } }),
      ],
      ["the duration", (w) => app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { durationSeconds: 1800 } })],
    ];

    it.each(changes)("%s makes it changed", async (_l, edit) => {
      const w = await finished();
      await send(w.workoutId);
      expect((await state(w.workoutId)).state).toBe("sent");
      const res = await edit(w);
      expect(res.statusCode, _l).toBeLessThan(300);
      expect((await state(w.workoutId)).state).toBe("changed");
    });

    it("a section name change makes it changed", async () => {
      const w = await finished();
      const section = (await app.inject({ method: "POST", url: `/v1/workouts/${w.workoutId}/sections`, headers: A, payload: { name: "Finisher" } })).json() as { id: string };
      await send(w.workoutId);
      await app.inject({ method: "PATCH", url: `/v1/workout-sections/${section.id}`, headers: A, payload: { name: "Burnout" } });
      expect((await state(w.workoutId)).state).toBe("changed");
    });

    it("a no-op title PATCH leaves it sent", async () => {
      const w = await finished();
      await app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { title: "Same" } });
      await send(w.workoutId);
      await app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { title: "Same" } });
      expect((await state(w.workoutId)).state).toBe("sent");
    });

    it("an update cycle returns it to sent; an edit between begin and complete reads changed", async () => {
      const w = await finished();
      await send(w.workoutId, "H1");
      await app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { title: "Edited" } });
      expect((await state(w.workoutId)).state).toBe("changed");
      await send(w.workoutId, "H1");
      expect((await state(w.workoutId)).state).toBe("sent");
      const fp = ((await begin(w.workoutId)).json() as { fingerprint: string }).fingerprint;
      await app.inject({ method: "PATCH", url: `/v1/workouts/${w.workoutId}`, headers: A, payload: { title: "Mid-send" } });
      await complete(w.workoutId, "H1", fp);
      expect((await state(w.workoutId)).state).toBe("changed");
    });
  });

  describe("19.0 AC30 — release", () => {
    it("deletes a claim-only row; clears a linked row's claim and keeps the link; idempotent", async () => {
      const { workoutId: claimOnly } = await finished();
      await begin(claimOnly);
      expect((await release(claimOnly)).statusCode).toBe(204);
      expect((await release(claimOnly)).statusCode).toBe(204);
      const rows = await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM hevy_link WHERE workout_id = $1::uuid`, claimOnly);
      expect(rows).toEqual([]);
      const { workoutId: linked } = await finished();
      await send(linked, "H3");
      await begin(linked);
      expect((await release(linked)).statusCode).toBe(204);
      const link = await db.prisma.$queryRawUnsafe<{ hevy_workout_id: string; claimed_at: Date | null }[]>(`SELECT hevy_workout_id, claimed_at FROM hevy_link WHERE workout_id = $1::uuid`, linked);
      expect(link).toEqual([{ hevy_workout_id: "H3", claimed_at: null }]);
    });
  });

  describe("19.0 AC31 — deleted workouts (Review Focus 2)", () => {
    it("a claim-only workout leaves no row; a linked one leaves a tombstone holding its Hevy id", async () => {
      const { workoutId: claimOnly } = await finished();
      await begin(claimOnly);
      await app.inject({ method: "DELETE", url: `/v1/workouts/${claimOnly}`, headers: A });
      expect(await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM hevy_link`)).toEqual([]);
      const { workoutId: linked } = await finished();
      await send(linked, "H5");
      expect((await app.inject({ method: "DELETE", url: `/v1/workouts/${linked}`, headers: A })).statusCode).toBe(204);
      const tomb = await db.prisma.$queryRawUnsafe<{ workout_id: string | null; hevy_workout_id: string }[]>(`SELECT workout_id::text, hevy_workout_id FROM hevy_link`);
      expect(tomb).toEqual([{ workout_id: null, hevy_workout_id: "H5" }]);
    });
  });

  describe("19.0 AC37 — link logs", () => {
    it("begun carries mode and stale_claim; completed and released carry the user only; none carries a Hevy id", async () => {
      const { workoutId } = await finished();
      await send(workoutId, "HEVYID42");
      await release(workoutId);
      expect(lines.find((l) => l.msg === "hevy_link_begun")).toMatchObject({ user_id: A_ID, mode: "create", stale_claim: false });
      expect(lines.find((l) => l.msg === "hevy_link_completed")).toMatchObject({ user_id: A_ID });
      expect(lines.find((l) => l.msg === "hevy_link_released")).toMatchObject({ user_id: A_ID });
      expect(JSON.stringify(lines.filter((l) => String(l.msg).startsWith("hevy_link")))).not.toContain("HEVYID42");
    });
  });
});
