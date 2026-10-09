import type { FastifyBaseLogger } from "fastify";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import { uuidv7 } from "uuidv7";
import { buildTestApp, limitsWith } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeWorkoutRepository } from "../helpers/fakes.js";

const BEARER = { authorization: "Bearer test-token" };
const ID = "018fcb3e-3b8a-7d6e-9c1a-000000000001";
const VALID_CURSOR = `v1.${Buffer.from(JSON.stringify({ s: "2026-09-01T10:00:00.000000Z", i: ID })).toString("base64url")}`;

/** A test app plus a helper that seeds n finished workouts for the caller. */
async function setup(opts: { logger?: FastifyBaseLogger; rateLimits?: ReturnType<typeof limitsWith> } = {}) {
  const workoutRepo = new FakeWorkoutRepository(new FakeExerciseRepository());
  const { app } = await buildTestApp({ workoutRepository: workoutRepo, ...opts });
  const me = await app.inject({ method: "GET", url: "/v1/me", headers: BEARER });
  const userId = me.json().id as string;
  const seed = (n: number, title = "Session") => {
    for (let k = 0; k < n; k++) {
      const id = uuidv7();
      const startedAt = new Date(Date.UTC(2026, 0, 1) + k * 86_400_000);
      workoutRepo.workouts.set(id, {
        id, userId, title, notes: null, startedAt, endedAt: new Date(startedAt.getTime() + 3_600_000),
        localDate: startedAt.toISOString().slice(0, 10), tzOffsetMinutes: 0, clientGeneratedId: uuidv7(),
        source: "manual", createdAt: startedAt, updatedAt: startedAt, routineName: null,
      });
    }
  };
  return { app, workoutRepo, seed };
}
const get = (app: Awaited<ReturnType<typeof setup>>["app"], qs = "") =>
  app.inject({ method: "GET", url: `/v1/workouts${qs}`, headers: BEARER });

describe("AC1 — contract", () => {
  it("200 { items, next } with the summary shape", async () => {
    const { app, seed } = await setup();
    seed(2);
    const res = await get(app);
    expect(res.statusCode).toBe(200);
    expect(res.json().next).toBeNull();
    expect(res.json().items[0]).toMatchObject({ exerciseCount: 0, exerciseNames: [], workingSetCount: 0, totalVolume: null, recordCount: 0 });
  });
  it("401 without a token", async () => {
    const { app } = await setup();
    expect((await app.inject({ method: "GET", url: "/v1/workouts" })).statusCode).toBe(401);
  });
});

describe("AC5 — limit", () => {
  it("defaults to 20: 21 rows → 20 items and a next cursor", async () => {
    const { app, seed } = await setup();
    seed(21);
    const body = (await get(app)).json();
    expect(body.items).toHaveLength(20);
    expect(typeof body.next).toBe("string");
  });
  it.each(["1", "50"])("limit=%s is accepted", async (limit) => {
    const { app, seed } = await setup();
    seed(3);
    expect((await get(app, `?limit=${limit}`)).statusCode).toBe(200);
  });
  it.each(["0", "51", "2.5", "-1", "abc", ""])("limit=%j → 422 on `limit`", async (limit) => {
    const { app } = await setup();
    const res = await get(app, `?limit=${limit}`);
    expect(res.statusCode).toBe(422);
    expect(res.json().errors.some((e: { path: string }) => e.path === "limit")).toBe(true);
  });
  it("Review Focus 2 — repeated params are 422, not 500", async () => {
    const { app } = await setup();
    expect((await get(app, "?limit=5&limit=6")).statusCode).toBe(422);
    expect((await get(app, `?cursor=${VALID_CURSOR}&cursor=${VALID_CURSOR}`)).statusCode).toBe(422);
  });
});

describe("AC7 — a malformed cursor is 422 on `cursor`, before any query", () => {
  it.each([["garbage", "?cursor=not-a-cursor"], ["Review Focus 3 — empty", "?cursor="]])("%s", async (_l, qs) => {
    const { app, workoutRepo } = await setup();
    const res = await get(app, qs);
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toMatch(/validation-error$/);
    expect(res.json().errors).toEqual([expect.objectContaining({ path: "cursor" })]);
    expect(workoutRepo.historyScans).toBe(0);
  });
  it("same problem type as a bad limit", async () => {
    const { app } = await setup();
    expect((await get(app, "?cursor=x")).json().type).toBe((await get(app, "?limit=0")).json().type);
  });
});

describe("AC11 — empty history", () => {
  it("{ items: [], next: null }", async () => {
    const { app } = await setup();
    expect((await get(app)).json()).toEqual({ items: [], next: null });
  });
});

describe("AC16 — caching and write limits", () => {
  it("Cache-Control: no-store, no ETag", async () => {
    const { app } = await setup();
    const res = await get(app);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers.etag).toBeUndefined();
  });
  it("is not in the workouts write group (no writeGroup): 5 GETs under a 1-write limit all succeed", async () => {
    const { app } = await setup({ rateLimits: limitsWith({ groups: { workouts: 1 } }) });
    for (let k = 0; k < 5; k++) expect((await get(app)).statusCode).toBe(200);
  });
});

describe("AC19 — logging", () => {
  it("the cursor token appears only in the generic request line's req.url; no title or volume anywhere", async () => {
    const lines: string[] = [];
    const logger = pino({ level: "debug" }, { write: (s: string) => lines.push(s) });
    const { app, seed } = await setup({ logger });
    seed(3, "distinctive-title-xyz");
    const first = (await get(app, "?limit=1")).json();
    await get(app, `?limit=1&cursor=${first.next}`);
    await get(app, "?cursor=v1.bogus-token-123");
    // Every route's generic request line logs its URL, query string included
    // (as for ?since= and ?exerciseId=). The cursor is a position, not a
    // secret (D10), so that line is accepted; nothing else may carry it.
    const withoutRequestUrl = lines
      .map((l) => JSON.parse(l) as { req?: { url?: string } })
      .map((o) => (o.req?.url ? { ...o, req: { ...o.req, url: "[request-url]" } } : o))
      .map((o) => JSON.stringify(o))
      .join("\n");
    expect(withoutRequestUrl).not.toContain(first.next);
    expect(withoutRequestUrl).not.toContain("bogus-token-123");
    const all = lines.join("\n");
    expect(all).not.toContain("distinctive-title-xyz");
    expect(all).not.toMatch(/totalVolume/);
  });
});
