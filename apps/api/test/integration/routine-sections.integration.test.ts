// apps/api/test/integration/routine-sections.integration.test.ts
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { RoutineWriteSchema } from "@sin/core";
import { ExerciseRetiredError } from "../../src/errors/app-error.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import type { RoutineRecord } from "../../src/repositories/routine.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertDerivedColumnsConsistent } from "./planned-set-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

describe.skipIf(!shouldRunIntegration())("Spec 09.2 — routine sections (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    if (!db) return;
    await assertSectionsConsistent(db);
    await assertDerivedColumnsConsistent(db);
    await db.prisma.$executeRawUnsafe(TRUNCATE_ROUTINES);
  });
  const repo = () => createRoutineRepository(db.prisma);
  /** Goes through the request schema exactly as the route does. */
  const parse = (b: unknown) => RoutineWriteSchema.parse(b);
  const rawHash = async (routineId: string): Promise<string> => {
    const rows = await db.prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT (SELECT coalesce(string_agg(to_jsonb(s)::text, ',' ORDER BY s.id), '') FROM "routine_section" s WHERE s.routine_id = $1::uuid)
           || (SELECT coalesce(string_agg(to_jsonb(i)::text, ',' ORDER BY i.id), '') FROM "routine_item" i WHERE i.routine_id = $1::uuid) AS t`,
      routineId,
    );
    return createHash("md5").update(rows[0]!.t).digest("hex");
  };
  const sectionIds = async (routineId: string) =>
    (await db.prisma.$queryRawUnsafe<{ id: string }[]>(`SELECT id::text FROM "routine_section" WHERE routine_id = $1::uuid ORDER BY position`, routineId)).map((r) => r.id);

  async function fixture() {
    const u = await insertUser(db);
    const [a, b, c] = [await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u }), await insertExercise(db, { ownerUserId: u })];
    return { u, a, b, c };
  }

  it("AC4 — create stores positions by index, maps items to sections, and a re-read is identical", async () => {
    const { u, a, b, c } = await fixture();
    const created = (await repo().create(u, parse({
      name: "Push day", notes: "note",
      sections: [{ key: "warm", name: "Warm-up", notes: "5 min rower" }, { key: "main", name: "Main" }],
      items: [{ exerciseId: a }, { exerciseId: b, sectionKey: "main", supersetGroup: 1 }, { exerciseId: c, sectionKey: "main", supersetGroup: 1 }],
    }))).routine;
    expect(created.sections.map((s) => [s.position, s.name, s.notes])).toEqual([[0, "Warm-up", "5 min rower"], [1, "Main", null]]);
    const main = created.sections[1]!.id;
    expect(created.items.map((i) => i.sectionId)).toEqual([null, main, main]);
    expect(await repo().getById(u, created.id)).toEqual(created);
    expect(((await repo().list(u)).routines)[0]).toEqual(created);
  });

  it("AC4 — a body with no sections reads sections: [] and sectionId: null", async () => {
    const { u, a } = await fixture();
    const r = (await repo().create(u, parse({ name: "Plain", items: [{ exerciseId: a }] }))).routine;
    expect(r.sections).toEqual([]);
    expect(r.items[0]!.sectionId).toBeNull();
  });

  it("Review Focus 2 — a section keyed `__proto__` and an item pointing at it round-trip", async () => {
    const { u, a } = await fixture();
    const r = (await repo().create(u, parse({ name: "Proto", sections: [{ key: "__proto__", name: "P" }], items: [{ exerciseId: a, sectionKey: "__proto__" }] }))).routine;
    expect(r.items[0]!.sectionId).toBe(r.sections[0]!.id);
  });

  it("AC9 — a PUT replaces the sections with fresh ids; none of the old survive; sections: [] removes all", async () => {
    const { u, a, b, c } = await fixture();
    const created = (await repo().create(u, parse({
      name: "R", sections: [{ key: "x", name: "X" }, { key: "y", name: "Y" }],
      items: [{ exerciseId: a, sectionKey: "x" }, { exerciseId: b, sectionKey: "x" }, { exerciseId: c, sectionKey: "y" }, { exerciseId: a, sectionKey: "y" }],
    }))).routine;
    const oldIds = await sectionIds(created.id);
    const replaced = await repo().replace(u, created.id, parse({ name: "R", sections: [{ key: "only", name: "Only" }], items: [{ exerciseId: a, sectionKey: "only" }, { exerciseId: b, sectionKey: "only" }] }));
    expect(replaced.sections).toHaveLength(1);
    const now = await sectionIds(created.id);
    expect(now).toHaveLength(1);
    expect(oldIds).not.toContain(now[0]);
    const cleared = await repo().replace(u, created.id, parse({ name: "R", sections: [], items: [{ exerciseId: a }] }));
    expect(cleared.sections).toEqual([]);
    expect(await sectionIds(created.id)).toEqual([]);
  });

  it("AC9 — a failing PUT leaves routine, sections and items byte-identical (a retired exercise; a failure AFTER the deletes)", async () => {
    const { u, a, b } = await fixture();
    const created = (await repo().create(u, parse({ name: "R", sections: [{ key: "x", name: "X" }], items: [{ exerciseId: a, sectionKey: "x" }, { exerciseId: b, sectionKey: "x" }] }))).routine;
    const before = await rawHash(created.id);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = false WHERE id = $1::uuid`, b);
    await expect(repo().replace(u, created.id, parse({ name: "R2", sections: [{ key: "z", name: "Z" }], items: [{ exerciseId: b, sectionKey: "z" }] }))).rejects.toBeInstanceOf(ExerciseRetiredError);
    expect(await rawHash(created.id)).toBe(before);
    await db.prisma.$executeRawUnsafe(`UPDATE "exercise" SET is_active = true WHERE id = $1::uuid`, b);
    // Bypass the schema: an undeclared key reaches insertItems AFTER both DELETEs and insertSections ran.
    await expect(
      repo().replace(u, created.id, { name: "R", sections: [{ key: "z", name: "Z" }], items: [{ exerciseId: a, sectionKey: "ghost" }] }),
    ).rejects.toThrow();
    expect(await rawHash(created.id)).toBe(before);
  });

  it("AC9 — deleting the routine deletes its sections", async () => {
    const { u, a } = await fixture();
    const r = (await repo().create(u, parse({ name: "R", sections: [{ key: "x", name: "X" }], items: [{ exerciseId: a }] }))).routine;
    await repo().delete(u, r.id);
    expect(await sectionIds(r.id)).toEqual([]);
  });

  it("AC10 — every optional shape round-trips exactly as sent", async () => {
    const { u, a, b } = await fixture();
    const shapes: Record<string, unknown> = {
      "only loose": { name: "S1", items: [{ exerciseId: a }] },
      "sections and no loose items": { name: "S2", sections: [{ key: "k", name: "K" }], items: [{ exerciseId: a, sectionKey: "k" }] },
      "an empty section and an unused declared section": { name: "S3", sections: [{ key: "e", name: "Empty", notes: "5 min" }, { key: "k", name: "K" }], items: [{ exerciseId: a }, { exerciseId: b, sectionKey: "k" }] },
      "same-named sections": { name: "S4", sections: [{ key: "p", name: "Accessory" }, { key: "q", name: "Accessory" }], items: [{ exerciseId: a, sectionKey: "p" }, { exerciseId: b, sectionKey: "q" }] },
    };
    for (const [label, body] of Object.entries(shapes)) {
      const created = (await repo().create(u, parse(body))).routine;
      const sent = (body as { sections?: { name: string; notes?: string }[] }).sections ?? [];
      expect(created.sections.map((s) => [s.name, s.notes]), label).toEqual(sent.map((s) => [s.name, s.notes ?? null]));
      expect(await repo().getById(u, created.id), label).toEqual(created);
    }
  });

  it("Review Focus 3 — a legacy PUT (no sections, no sectionKey) over a sectioned routine clears the sections and keeps the items", async () => {
    const { u, a, b } = await fixture();
    const created = (await repo().create(u, parse({ name: "R", sections: [{ key: "x", name: "X", notes: "n" }], items: [{ exerciseId: a, sectionKey: "x" }, { exerciseId: b, sectionKey: "x", notes: "keep" }] }))).routine;
    const flat = await repo().replace(u, created.id, parse({ name: "R", items: [{ exerciseId: a }, { exerciseId: b, notes: "keep" }] }));
    expect(flat.sections).toEqual([]);
    expect(flat.items.map((i) => [i.exerciseId, i.sectionId, i.notes])).toEqual([[a, null, null], [b, null, "keep"]]);
  });

  it("Review Focus 4 — CRLF/TAB notes and a 40-unit astral name are stored verbatim and never 500", async () => {
    const { u, a } = await fixture();
    // Zod 4 and Postgres char_length both count code points, so 40 emoji (80 UTF-16 units) is the legal maximum.
    const name = "\u{1F600}".repeat(40);
    const notes = "line one\r\nline\ttwo \u{1F4AA}\n";
    const r = (await repo().create(u, parse({ name: "Astral", sections: [{ key: "k", name, notes }], items: [{ exerciseId: a, sectionKey: "k" }] }))).routine;
    expect(r.sections[0]).toMatchObject({ name, notes });
    expect(RoutineWriteSchema.safeParse({ name: "x", sections: [{ key: "k", name: "\u{1F600}".repeat(41) }], items: [{ exerciseId: a }] }).success).toBe(false);
  });

  it("AC11 — recorded Spec 10.2 bodies store the same targets, planned sets and superset labels", async () => {
    const { u, a } = await fixture();
    const recorded = JSON.parse(readFileSync(new URL("../fixtures/routine-bodies-spec-10-2.json", import.meta.url), "utf8")) as {
      label: string; body: unknown; expect: { items: Record<string, unknown>[] };
    }[];
    for (const rec of recorded) {
      const r: RoutineRecord = (await repo().create(u, parse(JSON.parse(JSON.stringify(rec.body).replaceAll("$EX", a))))).routine;
      expect(r.sections, rec.label).toEqual([]);
      r.items.forEach((it, i) => {
        const want = rec.expect.items[i]!;
        expect([it.targetSets, it.targetRepsLow, it.targetRepsHigh, it.sets.length, it.supersetGroup, it.sectionId], rec.label)
          .toEqual([want.targetSets, want.targetRepsLow, want.targetRepsHigh, want.setCount, want.supersetGroup, null]);
      });
      await repo().delete(u, r.id);
    }
  });
});
