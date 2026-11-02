// Spec 09.5 AC6, AC7 (Review Focus 5) — routine sections take a timer: echo, replace, remove, ETag, races.
import type { FastifyInstance } from "fastify";
import {
  PLANNED_SETS_PER_ITEM_MAX,
  ROUTINE_ITEM_NOTES_MAX,
  ROUTINE_ITEMS_MAX,
  ROUTINE_NOTES_MAX,
  SECTION_NAME_MAX,
  SECTION_NOTES_MAX,
  SET_WEIGHT_MAX,
} from "@sin/core";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { strongEtag } from "../../src/routes/http-cache.js";
import { bearer, makeAccountApp } from "./account-helpers.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

const SET_TIMER = { format: "set_timer", roundSeconds: 300, rounds: 5 };
const AMRAP = { format: "amrap", capSeconds: 720 };

describe.skipIf(!shouldRunIntegration())("Spec 09.5 — routine timers (real Postgres)", () => {
  let db: IntegrationDb;
  let app: FastifyInstance;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
    app = await makeAccountApp(db);
  }, 180_000);
  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertSectionsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });

  let tokens = 0;
  async function lifter() {
    const token = `timed-${(tokens += 1)}`;
    const headers = { ...bearer(token), "content-type": "application/json" };
    const me = (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).json() as { id: string };
    const ex = await insertExercise(db, { ownerUserId: me.id });
    const send = (method: "POST" | "PUT", url: string, payload: unknown) => app.inject({ method, url, headers, payload: payload as object });
    const get = (url: string, extra: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...bearer(token), ...extra } });
    return { userId: me.id, ex, send, get };
  }
  const doc = (ex: string, timers: unknown[]) => ({
    name: "Timed",
    sections: timers.map((timer, j) => (timer === undefined ? { key: `s${j}`, name: `S${j}` } : { key: `s${j}`, name: `S${j}`, timer })),
    items: timers.map((_, j) => ({ exerciseId: ex, sectionKey: `s${j}` })),
  });
  const timersOf = (body: { sections: { timer: unknown }[] }) => body.sections.map((s) => s.timer);
  const storedColumns = async (routineId: string) =>
    db.prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT timer_format, timer_round_s, timer_rounds, timer_cap_s FROM "routine_section" WHERE routine_id = $1::uuid ORDER BY position`,
      routineId,
    );

  describe("09.5 AC6 — echo, replace, remove", () => {
    it("POST echoes each format; a time cap sent without a cap echoes capSeconds: null (Review Focus 5); GET equals it", async () => {
      const l = await lifter();
      const res = await l.send("POST", "/v1/routines", doc(l.ex, [SET_TIMER, AMRAP, { format: "time_cap" }]));
      expect(res.statusCode).toBe(201);
      const created = res.json();
      expect(timersOf(created)).toEqual([SET_TIMER, AMRAP, { format: "time_cap", capSeconds: null }]);
      expect(res.body).toContain('"timer":{"format":"time_cap","capSeconds":null}');
      expect((await l.get(`/v1/routines/${created.id}`)).json()).toEqual(created);
      expect(await storedColumns(created.id)).toEqual([
        { timer_format: "set_timer", timer_round_s: 300, timer_rounds: 5, timer_cap_s: null },
        { timer_format: "amrap", timer_round_s: null, timer_rounds: null, timer_cap_s: 720 },
        { timer_format: "time_cap", timer_round_s: null, timer_rounds: null, timer_cap_s: null },
      ]);
    });

    it("PUT replaces a timer, omitting it or sending null removes it, and a bad timer writes nothing", async () => {
      const l = await lifter();
      const created = (await l.send("POST", "/v1/routines", doc(l.ex, [SET_TIMER, AMRAP]))).json();
      const url = `/v1/routines/${created.id}`;

      const changed = await l.send("PUT", url, doc(l.ex, [SET_TIMER, { format: "amrap", capSeconds: 900 }]));
      expect(changed.statusCode).toBe(200);
      expect(timersOf(changed.json())).toEqual([SET_TIMER, { format: "amrap", capSeconds: 900 }]);

      const omitted = await l.send("PUT", url, doc(l.ex, [undefined, AMRAP]));
      expect(timersOf(omitted.json())).toEqual([null, AMRAP]);
      expect((await storedColumns(created.id))[0]).toEqual({ timer_format: null, timer_round_s: null, timer_rounds: null, timer_cap_s: null });

      const nulled = await l.send("PUT", url, doc(l.ex, [SET_TIMER, null]));
      expect(timersOf(nulled.json())).toEqual([SET_TIMER, null]);

      const before = (await l.get(url)).json();
      const bad = await l.send("PUT", url, doc(l.ex, [AMRAP, { format: "amrap", capSeconds: 0 }]));
      expect(bad.statusCode).toBe(422);
      expect(JSON.stringify(bad.json())).toContain("sections.1.timer.capSeconds");
      expect((await l.get(url)).json()).toEqual(before);
    });
  });

  it("09.5 AC6 — the maximum document with eight timers fits the 128 KiB limit", async () => {
    const l = await lifter();
    const maxRow = { setType: "warmup", repsLow: 100, repsHigh: 100, weight: SET_WEIGHT_MAX, weightUnit: "kg" };
    const worst = {
      name: "Worst case",
      notes: "n".repeat(ROUTINE_NOTES_MAX),
      sections: Array.from({ length: 8 }, (_, j) => ({
        key: `k${j}`,
        name: "n".repeat(SECTION_NAME_MAX),
        notes: "x".repeat(SECTION_NOTES_MAX),
        timer: { format: "set_timer", roundSeconds: 3600, rounds: 100 },
      })),
      items: Array.from({ length: ROUTINE_ITEMS_MAX }, (_, i) => ({
        exerciseId: l.ex,
        notes: "x".repeat(ROUTINE_ITEM_NOTES_MAX),
        sectionKey: `k${Math.min(7, Math.floor(i / 4))}`,
        sets: Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, () => maxRow),
      })),
    };
    const payload = JSON.stringify(worst);
    expect(payload.length).toBeLessThan(128 * 1024);
    const res = await l.send("POST", "/v1/routines", payload);
    expect(res.statusCode).toBe(201);
    expect(res.json().sections.every((s: { timer: unknown }) => s.timer !== null)).toBe(true);
  });

  it("09.5 AC7 — ETag: stable, changes with a timer, the same body echoes the same document, a pre-deploy validator is 200", async () => {
    const l = await lifter();
    const body = doc(l.ex, [SET_TIMER, { format: "time_cap" }]);
    const created = (await l.send("POST", "/v1/routines", body)).json();
    const url = `/v1/routines/${created.id}`;
    const etag = async () => (await l.get(url)).headers.etag as string;
    const first = await etag();
    expect(await etag()).toBe(first);

    // A PUT re-mints ids and updatedAt (Spec 09 D2), so two PUTs never share bytes; what must hold is that
    // the same body stores and echoes the same document apart from those (Review Focus 5).
    const withoutIds = (r: { sections: Record<string, unknown>[]; items: Record<string, unknown>[] }) => ({
      sections: r.sections.map(({ id: _i, ...s }) => s),
      items: r.items.map(({ id: _i, sectionId: _s, ...i }) => i),
    });
    const again = doc(l.ex, [{ ...SET_TIMER, rounds: 6 }, { format: "time_cap" }]);
    const firstPut = (await l.send("PUT", url, again)).json();
    const afterTimer = await etag();
    expect(afterTimer).not.toBe(first);
    expect(await etag()).toBe(afterTimer);
    const secondPut = (await l.send("PUT", url, again)).json();
    expect(withoutIds(secondPut)).toEqual(withoutIds(firstPut));
    expect(timersOf(secondPut)).toEqual([{ ...SET_TIMER, rounds: 6 }, { format: "time_cap", capSeconds: null }]);
    const afterReplay = await etag();

    const now = (await l.get(url)).json();
    const preDeploy = { ...now, sections: now.sections.map(({ timer: _t, ...s }: Record<string, unknown>) => s) };
    const conditional = await l.get(url, { "if-none-match": strongEtag(`routine:${created.id}`, JSON.stringify(preDeploy)) });
    expect(conditional.statusCode).toBe(200);
    expect(await l.get(url, { "if-none-match": afterReplay }).then((r) => r.statusCode)).toBe(304);
  });

  it("09.5 AC7 — racing PUTs: every read afterwards is exactly one of the two documents", async () => {
    const l = await lifter();
    const created = (await l.send("POST", "/v1/routines", doc(l.ex, [SET_TIMER, AMRAP]))).json();
    const url = `/v1/routines/${created.id}`;
    const a = doc(l.ex, [{ ...SET_TIMER, rounds: 7 }, { format: "amrap", capSeconds: 600 }]);
    const b = doc(l.ex, [{ format: "time_cap", capSeconds: 1200 }, null]);
    const timersA = [{ ...SET_TIMER, rounds: 7 }, { format: "amrap", capSeconds: 600 }];
    const timersB = [{ format: "time_cap", capSeconds: 1200 }, null];
    for (let i = 0; i < 10; i++) {
      const [ra, rb] = await Promise.all([l.send("PUT", url, a), l.send("PUT", url, b)]);
      expect([ra.statusCode, rb.statusCode]).toEqual([200, 200]);
      const read = timersOf((await l.get(url)).json());
      expect([JSON.stringify(timersA), JSON.stringify(timersB)]).toContain(JSON.stringify(read));
    }
  });
});
