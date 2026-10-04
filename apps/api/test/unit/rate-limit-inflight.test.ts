import http from "node:http";
import type { FastifyBaseLogger, FastifyRequest } from "fastify";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { describe, expect, it, vi } from "vitest";
import { InflightCounter } from "../../src/plugins/rate-limit.js";
import { RateLimitedError } from "../../src/errors/app-error.js";
import { buildTestApp, limitsWith } from "../helpers/build-test-app.js";

const BEARER = { authorization: "Bearer test-token" };
const startWorkout = () => ({
  method: "POST" as const,
  url: "/v1/workouts",
  headers: BEARER,
  payload: { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000).toISOString() },
});
const patchMe = { method: "PATCH" as const, url: "/v1/me", headers: BEARER, payload: { displayName: "x" } };

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return { opened, open };
}
async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i += 1) await new Promise((r) => setImmediate(r));
  expect(cond()).toBe(true);
}

/** An app whose createWorkout parks on the gate until opened; `entered` counts arrivals. */
async function gatedApp(inflight: number) {
  const built = await buildTestApp({ rateLimits: limitsWith({ inflight }) });
  const g = gate();
  let entered = 0;
  const original = built.workoutRepo.createWorkout.bind(built.workoutRepo);
  built.workoutRepo.createWorkout = (async (...args: Parameters<typeof original>) => {
    entered += 1;
    await g.opened;
    return original(...args);
  }) as typeof original;
  return { ...built, g, entered: () => entered };
}

describe("AC8 — InflightCounter releases exactly once", () => {
  const req = (id: string) => ({ user: { id }, log: { warn: vi.fn() } }) as unknown as FastifyRequest;
  it("acquire/release/release leaves the map empty; over max throws Retry-After 1", () => {
    const c = new InflightCounter(1);
    const a = req("u1");
    c.acquire(a);
    expect(c.size).toBe(1);
    let err: unknown;
    try {
      c.acquire(req("u1"));
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RateLimitedError);
    expect((err as RateLimitedError).retryAfterSeconds).toBe(1);
    c.release(a);
    c.release(a);
    expect(c.size).toBe(0);
    c.release(req("u2")); // never acquired: no-op
    expect(c.size).toBe(0);
  });
});

describe("AC7 — the write past inflight.max is rejected at once", () => {
  it("one parked write + inflight 1 → a second write is 429 Retry-After 1; after it finishes, writes work", async () => {
    const { app, g, entered } = await gatedApp(1);
    const first = app.inject(startWorkout());
    await until(() => entered() === 1);
    const second = await app.inject(patchMe);
    expect(second.statusCode).toBe(429);
    expect(second.headers["retry-after"]).toBe("1");
    g.open();
    expect((await first).statusCode).toBe(201);
    expect((await app.inject(patchMe)).statusCode).toBe(200);
  });
  it("reads are not counted", async () => {
    const { app, g, entered } = await gatedApp(1);
    const first = app.inject(startWorkout());
    await until(() => entered() === 1);
    expect((await app.inject({ method: "GET", url: "/v1/me", headers: BEARER })).statusCode).toBe(200);
    g.open();
    await first;
  });
});

describe("AC8 — the slot is released on success, on an AppError and on a 500", () => {
  it("inflight 1: each outcome is followed by a write that is not 429", async () => {
    const { app, workoutRepo } = await buildTestApp({ rateLimits: limitsWith({ inflight: 1 }) });
    expect((await app.inject(patchMe)).statusCode).toBe(200);
    expect((await app.inject(patchMe)).statusCode).toBe(200);
    const notFound = await app.inject({ method: "PATCH", url: `/v1/sets/${uuidv7()}`, headers: BEARER, payload: { reps: 1 } });
    expect(notFound.statusCode).toBe(404);
    expect((await app.inject(patchMe)).statusCode).toBe(200);
    workoutRepo.createWorkout = (async () => {
      throw new Error("boom");
    }) as typeof workoutRepo.createWorkout;
    expect((await app.inject(startWorkout())).statusCode).toBe(500);
    expect((await app.inject(patchMe)).statusCode).toBe(200);
  });
});

describe("AC8 — a client abort keeps the slot until the handler finishes (D13)", () => {
  it("held while parked after the abort, released when the handler returns", async () => {
    const { app, g, entered } = await gatedApp(1);
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const { port } = app.server.address() as { port: number };
      const body = JSON.stringify(startWorkout().payload);
      const req = http.request({
        port,
        host: "127.0.0.1",
        method: "POST",
        path: "/v1/workouts",
        headers: { ...BEARER, "content-type": "application/json", "content-length": Buffer.byteLength(body) },
      });
      req.on("error", () => {});
      req.end(body);
      await until(() => entered() === 1);
      req.destroy();
      await new Promise((r) => setTimeout(r, 50));
      expect((await app.inject(patchMe)).statusCode).toBe(429); // still held
      g.open();
      await new Promise((r) => setTimeout(r, 50));
      expect((await app.inject(patchMe)).statusCode).toBe(200); // released via onSend
    } finally {
      await app.close();
    }
  });
});

describe("AC16 — L3 rejection log", () => {
  it("warn rate_limited layer user-inflight with userId", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const { app } = await buildTestApp({ logger, rateLimits: limitsWith({ inflight: 0 }) });
    await app.inject(patchMe);
    const hit = lines.find((l) => l.msg === "rate_limited");
    expect(hit).toMatchObject({ level: 40, layer: "user-inflight" });
    expect(typeof hit?.userId).toBe("string");
  });
});
