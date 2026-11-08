import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "../helpers.js";
import { makeCrossUserApp, type WorldActor } from "./app.js";
import { buildWorld, type World } from "./world.js";
import { snapshot } from "./snapshot.js";
import { NON_V1_ROUTES, type RegisteredRoute, type RouteKey } from "./registry.js";
import { EXEMPTIONS } from "./exemptions.js";
import { requiredSlots } from "./slots.js";
import { checkCoverage } from "./gate.js";
import { LeakScanner, freshIdFor, normalizeResponse } from "./compare.js";
import { CASES, type CaseApi, type CaseResponse, type CrossUserCase, type Req } from "./cases.js";

/**
 * Spec 21.0 Phase A — every `/v1` route is tested against another user's data.
 *
 * Once: build the world (A, B, C on real Postgres), build the app with the
 * route observer, and check the coverage gate (AC3, AC6). Then every case runs
 * in order on the one world: a correct app changes nothing on a rejected call,
 * so the first case that breaks that fails AC9/AC10 by name. Every response
 * body goes to the leak scan, which runs last (AC12).
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.0 — the cross-user route suite (real Postgres)", () => {
  let db: AppIntegrationDb;
  let app: FastifyInstance;
  let as: (actor: WorldActor) => Record<string, string>;
  let world: World;
  const routes = new Map<RouteKey, RegisteredRoute>();
  const other: RouteKey[] = [];
  const scanner = new LeakScanner();

  const call = async (actor: WorldActor, req: Req, where = `${req.method} ${req.url}`): Promise<CaseResponse> => {
    const res = await app.inject({
      method: req.method as "GET",
      url: req.url,
      headers: { ...as(actor), ...(req.body === undefined ? {} : { "content-type": "application/json" }) },
      ...(req.body === undefined ? {} : { payload: JSON.stringify(req.body) }),
    });
    // GENEROUS_LIMITS: a 429 is never an answer this suite expects.
    if (res.statusCode === 429) throw new Error(`${where} answered 429: the suite must run under GENEROUS_LIMITS`);
    if (actor !== "B") scanner.record(res.body, `${actor} ${where}`);
    return { status: res.statusCode, headers: res.headers, body: res.body };
  };

  const api: CaseApi = {
    call: (actor, req) => call(actor, req),
    must: async (actor, req, status) => {
      const res = await call(actor, req);
      if (res.status !== status) throw new Error(`${actor} ${req.method} ${req.url} answered ${res.status}, expected ${status}: ${res.body}`);
      return (res.body === "" ? {} : JSON.parse(res.body)) as { id: string };
    },
    rows: (sql, ...params) => db.prisma.$queryRawUnsafe(sql, ...params),
  };

  const userOf = (actor: WorldActor) => (actor === "A" ? world.a.userId : actor === "B" ? world.b.userId : world.c.userId);

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    world = await buildWorld(db);
    ({ app, as } = await makeCrossUserApp(db, {
      hevyUsers: [world.a.userId],
      onRoute: (route) => {
        const methods = Array.isArray(route.method) ? route.method : [route.method];
        for (const method of methods) {
          if (method === "HEAD" || method === "OPTIONS") continue;
          const key: RouteKey = `${method} ${route.url}`;
          if (route.url.startsWith("/v1/")) routes.set(key, { key, method, url: route.url, schema: route.schema });
          else other.push(key);
        }
      },
    }));
    await app.ready();
  }, 600_000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  it("AC3, AC6 — every /v1 route and every id slot has a case or a reasoned exemption", () => {
    const failures = checkCoverage([...routes.keys()], CASES, EXEMPTIONS, (key) => requiredSlots(routes.get(key)!));
    expect(failures).toEqual([]);
  });

  it("AC4 — every non-/v1 route is on the allow-list", () => {
    expect([...other].sort()).toEqual(Object.keys(NON_V1_ROUTES).sort());
  });

  /** The control: the same request on the actor's own data succeeds (AC11). */
  async function runControl(c: CrossUserCase, scratch: string | undefined) {
    const ctl = c.control(world, scratch);
    const res = await call(c.controlActor ?? c.actor, ctl, `control ${ctl.method} ${ctl.url}`);
    expect(res.status, `control ${c.route} — ${c.name}: ${res.body}`).toBe(ctl.expectStatus);
    if (ctl.expectId) expect(res.body, "control body holds the actor's own id").toContain(ctl.expectId);
  }

  describe("AC8–AC11, AC15 — another user's id answers exactly like an id that does not exist", () => {
    for (const c of CASES.filter((x) => x.kind === "foreign-id")) {
      it(`${c.route} — ${c.name}`, async () => {
        const route = routes.get(c.route);
        if (!route) throw new Error(`${c.route} is not registered`);
        const slot = c.covers[0]!;
        const foreign = c.foreignId!(world);
        const fresh = freshIdFor(route, slot);
        const actorUser = userOf(c.actor);

        const b0 = await snapshot(db, world.b.userId);
        const actor0 = await snapshot(db, actorUser);

        const withB = await call(c.actor, c.call(world, foreign), `${c.route} with B's id`);
        const withFresh = await call(c.actor, c.call(world, fresh), `${c.route} with a fresh id`);

        // AC8: pinned to spec §5, and indistinguishable once the ids are substituted.
        expect(withB.status, withB.body).toBe(c.expect.status);
        expect(normalizeResponse(withB, [foreign, fresh])).toEqual(normalizeResponse(withFresh, [foreign, fresh]));

        // AC9: B is unchanged. AC10: a rejected call changes nothing of the actor's either.
        expect(await snapshot(db, world.b.userId), "B's rows changed").toBe(b0);
        if (c.expect.status >= 400) expect(await snapshot(db, actorUser), "the actor's rows changed").toBe(actor0);

        // AC15: HEAD agrees with GET.
        if (route.method === "GET") {
          const headB = await call(c.actor, { method: "HEAD", url: c.call(world, foreign).url });
          const headFresh = await call(c.actor, { method: "HEAD", url: c.call(world, fresh).url });
          expect(headB.status).toBe(withB.status);
          expect(headFresh.status).toBe(headB.status);
        }

        // AC11: the control, on a disposable resource when it destroys its target.
        const scratch = c.disposable ? await c.disposable(world, api) : undefined;
        await runControl(c, scratch);
        expect(await snapshot(db, world.b.userId), "B's rows changed by the control").toBe(b0);
        await c.cleanup?.(world, api);
      });
    }
  });

  describe("AC9, AC13, AC14 — collections, key collisions and writes with no foreign id", () => {
    for (const c of CASES.filter((x) => x.kind !== "foreign-id")) {
      it(`${c.kind}: ${c.route} — ${c.name}`, async () => {
        // Setup first (it may act as B, e.g. for an exercise-list delta), then B's snapshot.
        const scratch = c.disposable ? await c.disposable(world, api) : undefined;
        const b0 = await snapshot(db, world.b.userId);
        // When C acts, A is a bystander too and must not change either.
        const a0 = c.actor === "A" ? undefined : await snapshot(db, world.a.userId);
        const res = await call(c.actor, c.call(world, scratch), `${c.route} (${c.name})`);
        expect(res.status, res.body).toBe(c.expect.status);
        await c.check?.(world, res, api);
        expect(await snapshot(db, world.b.userId), "B's rows changed").toBe(b0);
        if (a0 !== undefined) expect(await snapshot(db, world.a.userId), "A's rows changed").toBe(a0);
        await runControl(c, scratch);
        expect(await snapshot(db, world.b.userId), "B's rows changed by the control").toBe(b0);
        await c.cleanup?.(world, api);
      });
    }
  });

  it("AC12 — no response anywhere in the suite holds B's ids or markers", () => {
    expect(scanner.size).toBeGreaterThan(CASES.length);
    scanner.assertClean(world.b.allIds, world.b.markers);
  });
});
