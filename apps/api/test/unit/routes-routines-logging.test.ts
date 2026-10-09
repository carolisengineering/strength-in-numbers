import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, makeExerciseRecord } from "../helpers/fakes.js";

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
  return { app, lines };
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
