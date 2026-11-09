// Spec 09.5 AC8 — bodies the 10.3 editor sends today (no `timer`) replay with the same status and
// store sections with all four timer columns NULL. Taken from routine-sections / planned-sets-routines.
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { bearer, makeAccountApp } from "./account-helpers.js";
import { shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { insertExercise } from "./records-helpers.js";
import { TRUNCATE_ROUTINES } from "./routine-helpers.js";
import { assertSectionsConsistent } from "./section-helpers.js";

type Row = [label: string, body: (ex: string) => unknown, status: number];

const ROWS: Row[] = [
  ["loose only (Spec 09)", (ex) => ({ name: "Loose", items: [{ exerciseId: ex, targetSets: 3, targetRepsLow: 5, targetRepsHigh: 5 }] }), 201],
  [
    "sections with a superset inside one (09.2 AC4)",
    (ex) => ({
      name: "Push day",
      notes: "note",
      sections: [{ key: "warm", name: "Warm-up", notes: "5 min rower" }, { key: "main", name: "Main" }],
      items: [{ exerciseId: ex }, { exerciseId: ex, sectionKey: "main", supersetGroup: 1 }, { exerciseId: ex, sectionKey: "main", supersetGroup: 1 }],
    }),
    201,
  ],
  ["an empty section with a note", (ex) => ({ name: "Empty", sections: [{ key: "w", name: "Warm-up", notes: "Rower" }], items: [{ exerciseId: ex }] }), 201],
  [
    "422: a loose item after a sectioned one (09.2 AC7 order)",
    (ex) => ({ name: "Order", sections: [{ key: "a", name: "A" }], items: [{ exerciseId: ex, sectionKey: "a" }, { exerciseId: ex }] }),
    422,
  ],
  [
    "422: a superset across sections (09.2 AC8 span)",
    (ex) => ({
      name: "Span",
      sections: [{ key: "a", name: "A" }, { key: "b", name: "B" }],
      items: [{ exerciseId: ex, sectionKey: "a", supersetGroup: 1 }, { exerciseId: ex, sectionKey: "b", supersetGroup: 1 }],
    }),
    422,
  ],
  [
    "planned sets in a section (09.1 + 09.2)",
    (ex) => ({
      name: "Planned",
      sections: [{ key: "m", name: "Main" }],
      items: [
        {
          exerciseId: ex,
          sectionKey: "m",
          sets: [
            { setType: "warmup", repsLow: 8, repsHigh: 8, weight: 40, weightUnit: "kg" },
            { setType: "working", repsLow: 5, repsHigh: 5, weight: 80, weightUnit: "kg" },
          ],
        },
      ],
    }),
    201,
  ],
  ["422: an undeclared section key", (ex) => ({ name: "Key", sections: [{ key: "a", name: "A" }], items: [{ exerciseId: ex, sectionKey: "zzz" }] }), 422],
];

describe.skipIf(!shouldRunIntegration())("Spec 09.5 AC8 — untimed bodies replay unchanged (real Postgres)", () => {
  let db: AppIntegrationDb;
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
  it.each(ROWS)("09.5 AC8 — 10.3 editor bodies without timer: %s → %i", async (_label, body, status) => {
    const token = `replay-${(tokens += 1)}`;
    const me = (await app.inject({ method: "GET", url: "/v1/me", headers: bearer(token) })).json() as { id: string };
    const ex = await insertExercise(db, { ownerUserId: me.id });
    const res = await app.inject({
      method: "POST",
      url: "/v1/routines",
      headers: { ...bearer(token), "content-type": "application/json" },
      payload: body(ex) as object,
    });
    expect(res.statusCode).toBe(status);
    if (status !== 201) return;
    const created = res.json() as { id: string; sections: { timer: unknown }[] };
    expect(created.sections.every((s) => s.timer === null)).toBe(true);
    const timed = await db.prisma.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*) AS n FROM "routine_section" WHERE routine_id = $1::uuid
         AND (timer_format IS NOT NULL OR timer_round_s IS NOT NULL OR timer_rounds IS NOT NULL OR timer_cap_s IS NOT NULL)`,
      created.id,
    );
    expect(Number(timed[0]!.n)).toBe(0);
  });
});
