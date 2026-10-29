import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, FakeWorkoutRepository, makeExerciseRecord } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const EX = makeExerciseRecord({ name: "Bench" });

function capturingLogger(): { logger: FastifyBaseLogger; lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
  return { logger, lines };
}

async function setup() {
  const { logger, lines } = capturingLogger();
  const exerciseRepo = new FakeExerciseRepository();
  exerciseRepo.byId.set(EX.id, EX);
  const routineRepo = new FakeRoutineRepository(exerciseRepo);
  const { app } = await buildTestApp({
    logger,
    exerciseRepository: exerciseRepo,
    routineRepository: routineRepo,
    rateLimits: GENEROUS_LIMITS,
  });
  return { app, lines, routineRepo };
}

describe("AC30 — routine log lines carry ids and counts only", () => {
  it("routine_created / routine_updated / routine_deleted fire once each with no name, notes or token text", async () => {
    const { app, lines } = await setup();
    const payload = {
      name: "distinctive-name-qzx",
      notes: "distinctive-notes-wvu",
      items: [{ exerciseId: EX.id, notes: "distinctive-item-note-tsr" }],
    };
    const created = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload });
    const id = created.json().id;
    await app.inject({
      method: "PUT",
      url: `/v1/routines/${id}`,
      headers: BEARER,
      payload: { ...payload, items: [...payload.items, ...payload.items] },
    });
    await app.inject({ method: "DELETE", url: `/v1/routines/${id}`, headers: BEARER });
    const byMsg = (m: string) => lines.filter((l) => l.msg === m);
    expect(byMsg("routine_created")).toHaveLength(1);
    expect(byMsg("routine_created")[0]).toMatchObject({ routine_id: id, item_count: 1 });
    expect(typeof byMsg("routine_created")[0]!.user_id).toBe("string");
    expect(byMsg("routine_updated")).toHaveLength(1);
    expect(byMsg("routine_updated")[0]).toMatchObject({ routine_id: id, item_count: 2 });
    expect(byMsg("routine_deleted")).toHaveLength(1);
    expect(byMsg("routine_deleted")[0]).toMatchObject({ routine_id: id });
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-|test-token/);
  });

  it("09.3 AC29 — routine_created carries one_off", async () => {
    const { app, lines } = await setup();
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "A", items: [{ exerciseId: EX.id }], oneOff: true } });
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "B", items: [{ exerciseId: EX.id }] } });
    expect(lines.filter((l) => l.msg === "routine_created").map((l) => l.one_off)).toEqual([true, false]);
  });

  it("09.3 AC29 — a list read that sweeps logs routine_one_offs_expired once with the count; none when nothing expired", async () => {
    const { app, lines, routineRepo } = await setup();
    for (const name of ["A", "B", "C"]) {
      await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name, items: [{ exerciseId: EX.id }], oneOff: true } });
    }
    await app.inject({ method: "GET", url: "/v1/routines", headers: BEARER });
    expect(lines.filter((l) => l.msg === "routine_one_offs_expired")).toEqual([]);
    const [a, b] = [...routineRepo.routines.values()].filter((r) => r.name !== "C");
    for (const r of [a!, b!]) r.oneOffUntil = new Date(Date.now() - 60_000);
    const res = await app.inject({ method: "GET", url: "/v1/routines", headers: BEARER });
    expect(res.json().routines.map((r: { name: string }) => r.name)).toEqual(["C"]);
    const swept = lines.filter((l) => l.msg === "routine_one_offs_expired");
    expect(swept).toHaveLength(1);
    expect(swept[0]).toMatchObject({ routine_count: 2 });
    expect(typeof swept[0]!.user_id).toBe("string");
    expect(Object.keys(swept[0]!)).not.toContain("routine_id");
  });

  it("09.3 AC29 — routine_kept carries changed: true, then false on a repeat, and no name text", async () => {
    const { app, lines } = await setup();
    const id = (
      await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "distinctive-name-qzx", items: [{ exerciseId: EX.id }], oneOff: true } })
    ).json().id as string;
    await app.inject({ method: "POST", url: `/v1/routines/${id}/keep`, headers: BEARER });
    await app.inject({ method: "POST", url: `/v1/routines/${id}/keep`, headers: BEARER });
    const kept = lines.filter((l) => l.msg === "routine_kept");
    expect(kept.map((l) => l.changed)).toEqual([true, false]);
    expect(kept[0]).toMatchObject({ routine_id: id });
    expect(typeof kept[0]!.user_id).toBe("string");
    expect(JSON.stringify(kept)).not.toMatch(/distinctive-/);
  });

  it("routine_limit_hit fires once at info when the cap is reached", async () => {
    const { app, lines } = await setup();
    for (let i = 0; i <= 50; i += 1) {
      await app.inject({
        method: "POST",
        url: "/v1/routines",
        headers: BEARER,
        payload: { name: `R${i}`, items: [{ exerciseId: EX.id }] },
      });
    }
    const hits = lines.filter((l) => l.msg === "routine_limit_hit");
    expect(hits).toHaveLength(1);
    expect(hits[0]!.level).toBe(30); // pino info
    expect(typeof hits[0]!.user_id).toBe("string");
  });
});

describe("AC33 — workout_started_from_routine never carries item-note text", () => {
  it("the start logs ids and counts only", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const { app } = await buildTestApp({
      logger,
      exerciseRepository: exerciseRepo,
      routineRepository: routineRepo,
      workoutRepository: new FakeWorkoutRepository(exerciseRepo, routineRepo),
      rateLimits: GENEROUS_LIMITS,
    });
    const created = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: BEARER,
      payload: { name: "R", items: [{ exerciseId: EX.id, notes: "distinctive-item-note-kpm" }] },
    });
    const started = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date().toISOString(), routineId: created.json().id },
    });
    expect(started.statusCode).toBe(201);
    const startLine = lines.find((l) => l.msg === "workout_started_from_routine");
    expect(startLine).toMatchObject({ routine_id: created.json().id, item_count: 1 });
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-|test-token/);
  });
});

describe("09.3 AC29 — one-off log lines carry ids, counts and booleans only", () => {
  it("create → sweep → Keep → start → finish with removal: the new fields are present and no text leaks", async () => {
    const { logger, lines } = capturingLogger();
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const routineRepo = new FakeRoutineRepository(exerciseRepo);
    const workoutRepo = new FakeWorkoutRepository(exerciseRepo, routineRepo);
    const { app } = await buildTestApp({ logger, exerciseRepository: exerciseRepo, routineRepository: routineRepo, workoutRepository: workoutRepo, rateLimits: GENEROUS_LIMITS });
    const doc = (name: string) => ({
      name,
      notes: "distinctive-notes-wvu",
      sections: [{ key: "s", name: "distinctive-section-mno", notes: "distinctive-section-note-pqr" }],
      items: [{ exerciseId: EX.id, sectionKey: "s", notes: "distinctive-item-note-tsr" }],
      oneOff: true,
    });
    const stale = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: doc("distinctive-stale-abc") })).json().id as string;
    const kept = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: doc("distinctive-kept-def") })).json().id as string;
    const used = (await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: doc("distinctive-used-ghi") })).json().id as string;
    routineRepo.routines.get(stale)!.oneOffUntil = new Date(Date.now() - 60_000);
    await app.inject({ method: "GET", url: "/v1/routines", headers: BEARER });
    await app.inject({ method: "POST", url: `/v1/routines/${kept}/keep`, headers: BEARER });
    const started = await app.inject({
      method: "POST",
      url: "/v1/workouts",
      headers: BEARER,
      payload: { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 3_600_000).toISOString(), title: "distinctive-title-jkl", routineId: used },
    });
    await app.inject({ method: "PATCH", url: `/v1/workouts/${started.json().id}`, headers: BEARER, payload: { endedAt: new Date().toISOString() } });

    const one = (msg: string) => {
      const found = lines.filter((l) => l.msg === msg);
      expect(found.length, msg).toBeGreaterThan(0);
      return found[0]!;
    };
    expect(typeof one("routine_created").one_off).toBe("boolean");
    expect(one("routine_kept").changed).toBe(true);
    expect(one("routine_one_offs_expired").routine_count).toBe(1);
    expect(one("workout_finished")).toMatchObject({ one_off_removed: true, one_off_kept: false });
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-|test-token/);
  });
});

describe("Minor 42 — the sweep count is returned", () => {
  const U = uuidv7();
  const fields = (name: string, oneOff = false) => ({ name, notes: null, items: [{ exerciseId: EX.id }], ...(oneOff ? { oneOff: true as const } : {}) });
  const expireAll = (repo: FakeRoutineRepository) => {
    for (const r of repo.routines.values()) if (r.oneOffUntil !== null) r.oneOffUntil = new Date(Date.now() - 60_000);
  };

  it("list returns { routines, swept }", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const repo = new FakeRoutineRepository(exerciseRepo);
    await repo.create(U, fields("A", true));
    await repo.create(U, fields("B", true));
    await repo.create(U, fields("C"));
    expireAll(repo);
    const first = await repo.list(U);
    expect([first.swept, first.routines.map((r) => r.name)]).toEqual([2, ["C"]]);
    expect((await repo.list(U)).swept).toBe(0);
  });

  it("create returns { routine, swept }", async () => {
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const repo = new FakeRoutineRepository(exerciseRepo);
    await repo.create(U, fields("A", true));
    expireAll(repo);
    const out = await repo.create(U, fields("B"));
    expect([out.swept, out.routine.name]).toEqual([1, "B"]);
  });

  it("the create route logs the count it returned, after the call", async () => {
    const { app, lines, routineRepo } = await setup();
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "A", items: [{ exerciseId: EX.id }], oneOff: true } });
    expireAll(routineRepo);
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "B", items: [{ exerciseId: EX.id }] } });
    expect(res.statusCode).toBe(201);
    expect(lines.filter((l) => l.msg === "routine_one_offs_expired").map((l) => l.routine_count)).toEqual([1]);
  });

  it("Review Focus 2 — a create that fails after its sweep logs nothing (the real sweep rolls back with it)", async () => {
    const { app, lines, routineRepo } = await setup();
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "A", items: [{ exerciseId: EX.id }], oneOff: true } });
    await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "B", items: [{ exerciseId: EX.id }] } });
    expireAll(routineRepo);
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: { name: "B", items: [{ exerciseId: EX.id }] } });
    expect(res.statusCode).toBe(409);
    expect(lines.filter((l) => l.msg === "routine_one_offs_expired")).toEqual([]);
  });
});

describe("Minor 39 — two workout fakes on one routine fake", () => {
  it("Review Focus 1 — both fakes' live workouts hold their routines; neither overwrites the other", async () => {
    const U = uuidv7();
    const exerciseRepo = new FakeExerciseRepository();
    exerciseRepo.byId.set(EX.id, EX);
    const routines = new FakeRoutineRepository(exerciseRepo);
    const first = new FakeWorkoutRepository(exerciseRepo, routines);
    const second = new FakeWorkoutRepository(exerciseRepo, routines);
    const a = (await routines.create(U, { name: "A", notes: null, items: [{ exerciseId: EX.id }], oneOff: true })).routine;
    const b = (await routines.create(U, { name: "B", notes: null, items: [{ exerciseId: EX.id }], oneOff: true })).routine;
    const start = (repo: FakeWorkoutRepository, routineId: string) =>
      repo.createWorkout(U, { clientGeneratedId: uuidv7(), startedAt: new Date(), tzOffsetMinutes: 0, title: null, notes: null, routineId }, "UTC");
    await start(first, a.id);
    await start(second, b.id);
    for (const r of routines.routines.values()) r.oneOffUntil = new Date(Date.now() - 60_000);
    const listed = await routines.list(U);
    expect([listed.swept, listed.routines.map((r) => r.name).sort()]).toEqual([0, ["A", "B"]]);
  });
});
