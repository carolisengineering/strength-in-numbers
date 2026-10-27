import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import { pino } from "pino";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { createAccountExportRepository } from "../../src/repositories/account-export.prisma.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createHevyRepository } from "../../src/repositories/hevy.prisma.js";
import { createPersonalRecordRepository } from "../../src/repositories/personal-record.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createUserRepository } from "../../src/repositories/user.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { GENEROUS_LIMITS, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { TRUNCATE_ALL } from "./records-helpers.js";

const A_ID = "0192a1b2-0000-7000-8000-0000000000aa";
const B_ID = "0192a1b2-0000-7000-8000-0000000000bb";
const A = { authorization: "Bearer a" };
const B = { authorization: "Bearer b" };
const TITLE = "Distinctive Hevy Title";

type Pair = {
  hevyTemplateId: string;
  hevyTitle: string;
  hevyType: string | null;
  role: string;
  exerciseId: string | null;
  measureRule: string | null;
  exportAs: boolean;
};
const pair = (o: Partial<Pair> & { exerciseId: string | null }): Pair => ({
  hevyTemplateId: "T1",
  hevyTitle: TITLE,
  hevyType: "weight_reps",
  role: "exercise",
  measureRule: null,
  exportAs: false,
  ...o,
});

/** Spec 19.0 AC21–AC25, AC37 — the mapping routes against a real Postgres. */
describe.skipIf(!shouldRunIntegration())("Spec 19.0 Phase B — Hevy mapping (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  const lines: Record<string, unknown>[] = [];
  let mine: string;
  let mine2: string;
  let theirs: string;

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
    mine = await insertExercise(db, { ownerUserId: A_ID, modality: "weight_reps", name: "My bench" });
    mine2 = await insertExercise(db, { ownerUserId: A_ID, modality: "weight_reps", name: "My row" });
    theirs = await insertExercise(db, { ownerUserId: B_ID, modality: "weight_reps" });
    lines.length = 0;
  });

  const put = (body: unknown, headers = A) => app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers, payload: body as object });
  const patch = (body: unknown) => app.inject({ method: "PATCH", url: "/v1/hevy/mapping", headers: A, payload: body as object });
  const get = (headers: Record<string, string> = A) => app.inject({ method: "GET", url: "/v1/hevy/mapping", headers });
  const invariant = () =>
    db.prisma.$queryRawUnsafe<unknown[]>(
      `SELECT exercise_id FROM hevy_exercise_pair WHERE role = 'exercise' GROUP BY 1 HAVING count(*) FILTER (WHERE export_as) <> 1`,
    );
  const flags = async () => ((await get()).json() as { pairs: Pair[] }).pairs.map((p) => [p.hevyTemplateId, p.exportAs]);

  describe("19.0 AC21 — read", () => {
    it("an empty mapping", async () => {
      const res = await get();
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ pairs: [], sectionRules: [] });
    });

    it("pairs by lowercase title then id; rules by name; never another user's rows", async () => {
      await put({ pairs: [pair({ hevyTemplateId: "Z", hevyTitle: "bench", exerciseId: mine }), pair({ hevyTemplateId: "A", hevyTitle: "Bench", exerciseId: mine2 }), pair({ hevyTemplateId: "M", hevyTitle: "apple", exerciseId: mine2 })], sectionRules: [{ name: "Warm-up", treatment: "warmup_placeholder" }, { name: "accessory", treatment: "notes_on_first" }] });
      await put({ pairs: [pair({ hevyTemplateId: "B1", exerciseId: theirs })], sectionRules: [] }, B);
      const body = (await get()).json() as { pairs: Pair[]; sectionRules: { name: string }[] };
      expect(body.pairs.map((p) => p.hevyTemplateId)).toEqual(["M", "A", "Z"]);
      expect(body.sectionRules.map((r) => r.name)).toEqual(["accessory", "Warm-up"]);
    });

    it("a strong ETag; If-None-Match gives 304; private, no-cache", async () => {
      const res = await get();
      expect(res.headers.etag).toMatch(/^"[0-9a-f]{32}"$/);
      expect(res.headers["cache-control"]).toBe("private, no-cache");
      expect((await get({ ...A, "if-none-match": String(res.headers.etag) })).statusCode).toBe(304);
    });
  });

  describe("19.0 AC22 — replace", () => {
    it("stores and returns the mapping; a second identical PUT gives the same body and ETag", async () => {
      const body = { pairs: [pair({ exerciseId: mine, exportAs: true })], sectionRules: [{ name: "Finisher", treatment: "notes_on_first" }] };
      const first = await put(body);
      expect(first.statusCode).toBe(200);
      const etag1 = (await get()).headers.etag;
      const second = await put(body);
      expect(second.json()).toEqual(first.json());
      expect((await get()).headers.etag).toBe(etag1);
    });

    it("exportAs is normalized: none marked → the first pair of the exercise", async () => {
      await put({ pairs: [pair({ hevyTemplateId: "P1", exerciseId: mine }), pair({ hevyTemplateId: "P2", exerciseId: mine })], sectionRules: [] });
      expect(await flags()).toEqual([["P1", true], ["P2", false]]);
    });

    it("a refused PUT leaves the previous mapping untouched", async () => {
      await put({ pairs: [pair({ exerciseId: mine, exportAs: true })], sectionRules: [{ name: "Finisher", treatment: "notes_on_first" }] });
      const snapshot = () =>
        db.prisma.$queryRawUnsafe<unknown[]>(
          `SELECT to_jsonb(p)::text AS row FROM hevy_exercise_pair p UNION ALL SELECT to_jsonb(r)::text FROM hevy_section_rule r ORDER BY 1`,
        );
      const before = await snapshot();
      const res = await put({ pairs: [pair({ exerciseId: theirs })], sectionRules: [] });
      expect(res.statusCode).toBe(422);
      expect(await snapshot()).toEqual(before);
    });
  });

  describe("19.0 AC23 — replace validation", () => {
    it.each([
      ["another user's exercise", () => pair({ exerciseId: theirs })],
      ["a malformed id", () => pair({ exerciseId: "not-a-uuid" })],
    ])("%s is 422 naming pairs.0.exerciseId", async (_l, make) => {
      const res = await put({ pairs: [make()], sectionRules: [] });
      expect(res.statusCode).toBe(422);
      expect(JSON.stringify(res.json())).not.toContain(TITLE);
    });

    it("a retired exercise is 422 at pairs.0.exerciseId", async () => {
      const retired = await insertExercise(db, { ownerUserId: A_ID, isActive: false });
      const res = await put({ pairs: [pair({ exerciseId: retired })], sectionRules: [] });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual(["pairs.0.exerciseId"]);
    });

    it("more than 2,000 pairs is 422", async () => {
      const pairs = Array.from({ length: 2001 }, (_, i) => pair({ hevyTemplateId: `S${i}`, role: "skip", exerciseId: null, hevyType: "duration" }));
      expect((await put({ pairs, sectionRules: [] })).statusCode).toBe(422);
    });

    it("a body over 512 KiB is 413", async () => {
      const res = await app.inject({ method: "PUT", url: "/v1/hevy/mapping", headers: { ...A, "content-type": "application/json" }, payload: `{"pairs":[],"sectionRules":[],"x":"${"y".repeat(600 * 1024)}"}` });
      expect(res.statusCode).toBe(413);
    });
  });

  describe("19.0 AC24 — patch", () => {
    it("upsert is idempotent, and an exercise's first pairing becomes its exportAs", async () => {
      const body = { upsert: [pair({ hevyTemplateId: "P1", exerciseId: mine })] };
      const first = await patch(body);
      expect(first.statusCode).toBe(200);
      expect((await patch(body)).json()).toEqual(first.json());
      expect(await flags()).toEqual([["P1", true]]);
      expect(await invariant()).toEqual([]);
    });

    it("an upsert with exportAs true clears its sibling's flag", async () => {
      await patch({ upsert: [pair({ hevyTemplateId: "P1", hevyTitle: "a", exerciseId: mine })] });
      await patch({ upsert: [pair({ hevyTemplateId: "P2", hevyTitle: "b", exerciseId: mine, exportAs: true })] });
      expect(await flags()).toEqual([["P1", false], ["P2", true]]);
      expect(await invariant()).toEqual([]);
    });

    it("Review Focus 4: removing the exportAs pair promotes the oldest remaining one", async () => {
      await patch({ upsert: [pair({ hevyTemplateId: "P1", hevyTitle: "a", exerciseId: mine })] });
      await patch({ upsert: [pair({ hevyTemplateId: "P3", hevyTitle: "c", exerciseId: mine })] });
      await patch({ upsert: [pair({ hevyTemplateId: "P2", hevyTitle: "b", exerciseId: mine })] });
      await db.prisma.$executeRawUnsafe(`UPDATE hevy_exercise_pair SET created_at = now() - (interval '1 minute' * CASE hevy_template_id WHEN 'P1' THEN 3 WHEN 'P3' THEN 2 ELSE 1 END)`);
      expect(await flags()).toEqual([["P1", true], ["P2", false], ["P3", false]]);
      await patch({ remove: ["P1"] });
      expect(await flags()).toEqual([["P2", false], ["P3", true]]);
      expect(await invariant()).toEqual([]);
    });

    it("an unknown id in remove is ignored; {} is 422", async () => {
      expect((await patch({ remove: ["nope"] })).statusCode).toBe(200);
      expect((await patch({})).statusCode).toBe(422);
    });

    it("a second warm-up marker by patch is 422 at upsert.0.role", async () => {
      expect((await patch({ upsert: [pair({ hevyTemplateId: "W1", role: "warmup_placeholder", exerciseId: null })] })).statusCode).toBe(200);
      const res = await patch({ upsert: [pair({ hevyTemplateId: "W2", role: "warmup_placeholder", exerciseId: null })] });
      expect(res.statusCode).toBe(422);
      expect((res.json() as { errors: { path: string }[] }).errors.map((e) => e.path)).toEqual(["upsert.0.role"]);
    });
  });

  describe("19.0 AC25 — pairs survive exercise changes", () => {
    it("soft-deleting a paired exercise keeps the pair, read as exerciseActive false; a rename changes nothing stored", async () => {
      await put({ pairs: [pair({ exerciseId: mine, exportAs: true })], sectionRules: [] });
      const before = await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM hevy_exercise_pair`);
      await app.inject({ method: "PATCH", url: `/v1/exercises/${mine}`, headers: A, payload: { name: "Renamed" } });
      expect(await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT * FROM hevy_exercise_pair`)).toEqual(before);
      expect((await app.inject({ method: "DELETE", url: `/v1/exercises/${mine}`, headers: A })).statusCode).toBe(204);
      const read = (await get()).json() as { pairs: (Pair & { exerciseActive: boolean })[] };
      expect(read.pairs.map((p) => [p.exerciseId, p.exerciseActive])).toEqual([[mine, false]]);
    });
  });

  describe("19.0 AC37 — mapping logs", () => {
    it("replace and patch log counts only", async () => {
      await put({ pairs: [pair({ exerciseId: mine, exportAs: true })], sectionRules: [{ name: "Finisher", treatment: "notes_on_first" }] });
      await patch({ upsert: [pair({ hevyTemplateId: "P9", exerciseId: mine2 })], remove: ["T1"] });
      const replaced = lines.find((l) => l.msg === "hevy_mapping_replaced");
      const patched = lines.find((l) => l.msg === "hevy_mapping_patched");
      expect(replaced).toMatchObject({ user_id: A_ID, pairs: 1, section_rules: 1 });
      expect(patched).toMatchObject({ user_id: A_ID, upserts: 1, removals: 1, pairs: 1 });
      const text = JSON.stringify([replaced, patched]);
      expect(text).not.toContain(TITLE);
      expect(text).not.toContain("P9");
    });
  });
});
