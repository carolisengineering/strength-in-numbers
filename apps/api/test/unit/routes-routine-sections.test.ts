// apps/api/test/unit/routes-routine-sections.test.ts
import type { FastifyBaseLogger } from "fastify";
import { readFileSync } from "node:fs";
import { pino } from "pino";
import { describe, expect, it } from "vitest";
import {
  PLANNED_SETS_PER_ITEM_MAX, ROUTINE_ITEM_NOTES_MAX, ROUTINE_ITEMS_MAX, ROUTINE_NOTES_MAX,
  RoutineSchema, SECTION_NAME_MAX, SECTION_NOTES_MAX, SET_WEIGHT_MAX,
} from "@sin/core";
import { buildTestApp, GENEROUS_LIMITS } from "../helpers/build-test-app.js";
import { FakeExerciseRepository, FakeRoutineRepository, makeExerciseRecord } from "../helpers/fakes.js";
import { strongEtag } from "../../src/routes/http-cache.js";

const BEARER = { authorization: "Bearer test-token", "content-type": "application/json" };
const EX = makeExerciseRecord({ name: "Bench" });

async function setup(logger?: FastifyBaseLogger) {
  const exerciseRepo = new FakeExerciseRepository();
  exerciseRepo.byId.set(EX.id, EX);
  const { app } = await buildTestApp({
    logger, exerciseRepository: exerciseRepo,
    routineRepository: new FakeRoutineRepository(exerciseRepo), rateLimits: GENEROUS_LIMITS,
  });
  return app;
}
const post = (app: Awaited<ReturnType<typeof setup>>, payload: unknown) =>
  app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: payload as object });
const paths = (res: { json: () => { errors: { path: string }[] } }) => res.json().errors.map((e) => e.path).sort();

const sectioned = () => ({
  name: "Push day",
  notes: "Keep the whole session under 75 minutes.",
  sections: [
    { key: "warm", name: "Warm-up", notes: "5 min rower, then band pull-aparts 2 x 15." },
    { key: "main", name: "Main" },
  ],
  items: [
    { exerciseId: EX.id },
    { exerciseId: EX.id, sectionKey: "main", supersetGroup: 1 },
    { exerciseId: EX.id, sectionKey: "main", supersetGroup: 1 },
    { exerciseId: EX.id, sectionKey: "main" },
  ],
});

describe("AC4 — document form", () => {
  it("stores positions by array index, maps items to sections, echoes it, and never returns a key", async () => {
    const app = await setup();
    const res = await post(app, sectioned());
    expect(res.statusCode).toBe(201);
    const r = RoutineSchema.parse(res.json());
    expect(r.sections.map((s) => [s.position, s.name, s.notes])).toEqual([
      [0, "Warm-up", "5 min rower, then band pull-aparts 2 x 15."], [1, "Main", null],
    ]);
    const main = r.sections[1]!.id;
    expect(r.items.map((i) => i.sectionId)).toEqual([null, main, main, main]);
    expect(JSON.stringify(res.json())).not.toMatch(/"key"|"sectionKey"/);
    const read = await app.inject({ method: "GET", url: `/v1/routines/${r.id}`, headers: BEARER });
    expect(read.json()).toEqual(res.json());
  });
  it("a body without `sections` stores none; absent sections + an item sectionKey is 422 on that item", async () => {
    const app = await setup();
    const plain = await post(app, { name: "Plain", items: [{ exerciseId: EX.id }] });
    expect(plain.json().sections).toEqual([]);
    expect(plain.json().items[0].sectionId).toBeNull();
    const bad = await post(app, { name: "Bad", items: [{ exerciseId: EX.id, sectionKey: "main" }] });
    expect(bad.statusCode).toBe(422);
    expect(paths(bad)).toEqual(["items.0.sectionKey"]);
  });
});

describe("AC5 / AC6 / AC7 / AC8 — 422 paths, collected in one response", () => {
  it("every violation of one body is reported together on its own path", async () => {
    const app = await setup();
    const res = await post(app, {
      name: "Many",
      sections: [{ key: "a", name: "A" }, { key: "a", name: "A again" }],
      items: [{ exerciseId: EX.id, sectionKey: "a", supersetGroup: 1 }, { exerciseId: EX.id, sectionKey: "zzz", supersetGroup: 1 }],
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().type).toMatch(/validation-error$/);
    expect(paths(res)).toEqual(["items.1.sectionKey", "sections.1.key"]);
  });
  it("AC7 — a loose item after a sectioned one is 422 on that item's sectionKey", async () => {
    const app = await setup();
    const res = await post(app, { name: "Order", sections: [{ key: "a", name: "A" }], items: [{ exerciseId: EX.id, sectionKey: "a" }, { exerciseId: EX.id }] });
    expect(paths(res)).toEqual(["items.1.sectionKey"]);
  });
  it("AC8 — a superset across sections is 422 on the later member's supersetGroup", async () => {
    const app = await setup();
    const res = await post(app, {
      name: "Span", sections: [{ key: "a", name: "A" }, { key: "b", name: "B" }],
      items: [{ exerciseId: EX.id, sectionKey: "a", supersetGroup: 2 }, { exerciseId: EX.id, sectionKey: "b", supersetGroup: 2 }],
    });
    expect(paths(res)).toEqual(["items.1.supersetGroup"]);
  });
});

describe("AC2 — the ETag covers the new bytes", () => {
  it("a one-section note edit changes the validator; an unchanged routine keeps it; a pre-change validator no longer 304s", async () => {
    const app = await setup();
    const created = (await post(app, sectioned())).json();
    const etag = async () => (await app.inject({ method: "GET", url: `/v1/routines/${created.id}`, headers: BEARER })).headers.etag as string;
    const first = await etag();
    expect(await etag()).toBe(first);
    const edited = sectioned();
    edited.sections[1] = { key: "main", name: "Main", notes: "now with a note" } as never;
    await app.inject({ method: "PUT", url: `/v1/routines/${created.id}`, headers: BEARER, payload: edited });
    expect(await etag()).not.toBe(first);

    // A validator computed from the bytes BEFORE this spec (no `sections`, no `sectionId`).
    const now = (await app.inject({ method: "GET", url: `/v1/routines/${created.id}`, headers: BEARER })).json();
    const { sections: _s, ...rest } = now;
    const old = { ...rest, items: now.items.map(({ sectionId: _x, ...i }: Record<string, unknown>) => i) };
    const oldEtag = strongEtag(`routine:${created.id}`, JSON.stringify(old));
    const conditional = await app.inject({ method: "GET", url: `/v1/routines/${created.id}`, headers: { ...BEARER, "if-none-match": oldEtag } });
    expect(conditional.statusCode).toBe(200);
  });
});

describe("AC11 — Spec 10.2 editor bodies replay unchanged", () => {
  type Recorded = { label: string; body: unknown; expect: { status: number; items: Record<string, unknown>[] } };
  const recorded = JSON.parse(
    readFileSync(new URL("../fixtures/routine-bodies-spec-10-2.json", import.meta.url), "utf8"),
  ) as Recorded[];
  it.each(recorded.map((r) => [r.label, r] as const))("%s", async (_label, rec) => {
    const app = await setup();
    const body = JSON.parse(JSON.stringify(rec.body).replaceAll("$EX", EX.id));
    const res = await post(app, body);
    expect(res.statusCode).toBe(rec.expect.status);
    const r = res.json();
    expect(r.sections).toEqual([]);
    r.items.forEach((it: Record<string, unknown>, i: number) => {
      const want = rec.expect.items[i]!;
      expect(it.sectionId).toBeNull();
      expect([it.targetSets, it.targetRepsLow, it.targetRepsHigh, (it.sets as unknown[]).length, it.supersetGroup]).toEqual(
        [want.targetSets, want.targetRepsLow, want.targetRepsHigh, want.setCount, want.supersetGroup],
      );
    });
  });
});

describe("AC12 — body size: the legal maximum with 8 full sections fits the 128 KiB route limit", () => {
  const maxRow = { setType: "warmup", repsLow: 100, repsHigh: 100, weight: SET_WEIGHT_MAX, weightUnit: "kg" };
  const worst = () => ({
    name: "Worst case",
    notes: "n".repeat(ROUTINE_NOTES_MAX),
    sections: Array.from({ length: 8 }, (_, j) => ({ key: `k${j}`, name: "n".repeat(SECTION_NAME_MAX), notes: "x".repeat(SECTION_NOTES_MAX) })),
    items: Array.from({ length: ROUTINE_ITEMS_MAX }, (_, i) => ({
      exerciseId: EX.id, notes: "x".repeat(ROUTINE_ITEM_NOTES_MAX), sectionKey: `k${Math.min(7, Math.floor(i / 4))}`,
      sets: Array.from({ length: PLANNED_SETS_PER_ITEM_MAX }, () => maxRow),
    })),
  });
  it("is accepted (> 64 KiB, < 128 KiB) and a 130 KiB body is 413", async () => {
    const app = await setup();
    const payload = JSON.stringify(worst());
    expect(payload.length).toBeGreaterThan(64 * 1024);
    expect(payload.length).toBeLessThan(128 * 1024);
    const res = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload });
    expect(res.statusCode).toBe(201);
    const big = JSON.stringify({ ...worst(), notes: "n".repeat(130 * 1024) });
    const over = await app.inject({ method: "POST", url: "/v1/routines", headers: BEARER, payload: big });
    expect(over.statusCode).toBe(413);
  });
});

describe("AC27 — published schemas carry the new fields; 401 unchanged; no new problem slug", () => {
  it("the OpenAPI document mentions sections / sectionKey / sectionId on the routine routes", async () => {
    const { app } = await buildTestApp();
    await app.ready();
    const text = (await app.inject({ method: "GET", url: "/openapi.json" })).body;
    for (const name of ["sections", "sectionKey", "sectionId"]) expect(text).toContain(`"${name}"`);
  });
  it("an unauthenticated read is still 401", async () => {
    const { app } = await buildTestApp();
    expect((await app.inject({ method: "GET", url: "/v1/routines" })).statusCode).toBe(401);
  });
});

describe("AC28 — counts only in routine log lines", () => {
  it("routine_created / routine_updated carry section_count; no section name or note, no routine note", async () => {
    const lines: Record<string, unknown>[] = [];
    const logger: FastifyBaseLogger = pino({ level: "debug" }, { write: (s: string) => lines.push(JSON.parse(s)) });
    const app = await setup(logger);
    const body = {
      name: "distinctive-routine-qzx", notes: "distinctive-routine-note-wvu",
      sections: [{ key: "a", name: "distinctive-section-tsr", notes: "distinctive-section-note-pon" }, { key: "b", name: "B" }],
      items: [{ exerciseId: EX.id, sectionKey: "a", notes: "distinctive-item-note-mlk" }],
    };
    const id = (await post(app, body)).json().id;
    await app.inject({ method: "PUT", url: `/v1/routines/${id}`, headers: BEARER, payload: { ...body, sections: [body.sections[0]] } });
    const created = lines.find((l) => l.msg === "routine_created")!;
    const updated = lines.find((l) => l.msg === "routine_updated")!;
    expect(created).toMatchObject({ section_count: 2, item_count: 1 });
    expect(updated).toMatchObject({ section_count: 1 });
    expect(JSON.stringify(lines)).not.toMatch(/distinctive-/);
  });
});
