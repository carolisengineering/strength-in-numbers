import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { pino } from "pino";
import { uuidv7 } from "uuidv7";
import { ACCOUNT_PURGE_GRACE_DAYS } from "@sin/core";
import { runPurge } from "../../src/account/purge.js";
import { createExerciseRepository } from "../../src/repositories/exercise.prisma.js";
import { createRoutineRepository } from "../../src/repositories/routine.prisma.js";
import { createWorkoutRepository } from "../../src/repositories/workout.prisma.js";
import { shouldRunIntegration, startIntegrationDb, type IntegrationDb } from "./helpers.js";
import { insertExercise, insertUser, logWorkout } from "./records-helpers.js";
import { routineFixture } from "./routine-helpers.js";
import { tableHash, TRUNCATE_ACCOUNTS } from "./account-helpers.js";

const silent = pino({ level: "silent" });
const GRACE_S = ACCOUNT_PURGE_GRACE_DAYS * 86_400;
const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000);

/** Edges the purge may meet that are not CASCADE / SET NULL (D12). */
const NON_CASCADE_ALLOWLIST = new Set([
  "exercise.primary_muscle_id->muscle_group",
  "exercise.equipment_id->equipment",
  "exercise.forked_from_exercise_id->exercise",
]);

interface Edge { child: string; col: string; parent: string; rule: string }

describe.skipIf(!shouldRunIntegration())("Spec 11 — account:purge core (real Postgres)", () => {
  let db: IntegrationDb;
  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);
  afterAll(async () => {
    await db?.stop();
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    if (db) await db.prisma.$executeRawUnsafe(TRUNCATE_ACCOUNTS);
  });

  const workouts = () => createWorkoutRepository(db.prisma, createExerciseRepository(db.prisma));
  async function softDelete(userId: string, secondsAgo: number) {
    await db.prisma.$executeRawUnsafe(
      `UPDATE "user" SET deleted_at = now() - make_interval(secs => $2::float8) WHERE id = $1::uuid`, userId, secondsAgo);
  }
  async function exists(userId: string) {
    const rows = await db.prisma.$queryRawUnsafe<unknown[]>(`SELECT 1 FROM "user" WHERE id = $1::uuid`, userId);
    return rows.length === 1;
  }

  /** One of every user-owned row kind, incl. a fork, an item on a custom exercise, PRs, an in-progress workout. */
  async function fullAccount(userId: string, sharedGlobal: string) {
    const custom = await insertExercise(db, { ownerUserId: userId });
    await insertExercise(db, { ownerUserId: userId, forkedFrom: sharedGlobal });
    const routine = (await createRoutineRepository(db.prisma).create(
      userId,
      routineFixture([custom, sharedGlobal], { notes: "note", sections: [{ key: "k", name: "Main", notes: "n" }], sectionKeys: ["k", "k"] }),
    )).routine;
    const { workoutId } = await logWorkout(db, userId, { startedAt: daysAgo(2), finish: "none", exercises: [{ exerciseId: custom, sets: [{ reps: 5, weight: 100 }] }, { exerciseId: sharedGlobal, sets: [{ reps: 3, weight: 60 }] }] });
    await workouts().updateWorkout(userId, workoutId, { endedAt: new Date(daysAgo(2).getTime() + 3_600_000).toISOString() }); // creates personal_record rows
    // Spec 19.0 AC35: a row in each hevy_ table, so the purge's discovery has something to empty there too.
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "hevy_exercise_pair" (user_id, hevy_template_id, hevy_title, hevy_type, role, exercise_id, export_as)
       VALUES ($1::uuid, 'T-' || $1, 'Bench', 'weight_reps', 'exercise', $2::uuid, true)`,
      userId,
      custom,
    );
    await db.prisma.$executeRawUnsafe(`INSERT INTO "hevy_section_rule" VALUES ($1::uuid, 'accessory', 'Accessory', 'notes_on_first')`, userId);
    await db.prisma.$executeRawUnsafe(
      `INSERT INTO "hevy_link" (id, user_id, workout_id, hevy_workout_id, origin) VALUES (gen_random_uuid(), $1::uuid, $2::uuid, 'H-' || $1, 'sent')`,
      userId,
      workoutId,
    );
    await db.prisma.$executeRawUnsafe(`INSERT INTO "hevy_account" (user_id) VALUES ($1::uuid)`, userId);
    // The in-progress workout is started from the routine, so workout_planned_set has
    // victim rows (AC23's vacuous-pass guard; routineFixture's legacy items expand to rows).
    await workouts().createWorkout(
      userId,
      { clientGeneratedId: uuidv7(), startedAt: new Date(Date.now() - 60_000), tzOffsetMinutes: 0, title: null, notes: null, routineId: routine.id },
      "UTC",
    );
  }

  /** A row's identity: its id, or (Spec 19.0's id-less hevy tables) its whole content. */
  const ROW_KEY = "COALESCE(to_jsonb(t)->>'id', to_jsonb(t)::text)";

  async function fkEdges(): Promise<Edge[]> {
    return db.prisma.$queryRawUnsafe<Edge[]>(`
      SELECT c.conrelid::regclass::text AS child, a.attname AS col, c.confrelid::regclass::text AS parent,
             c.confdeltype::text AS rule
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace AND array_length(c.conkey, 1) = 1`);
  }

  /** Victim row ids per table, by following FK edges from "user" to a fixpoint. */
  async function victimRows(edges: Edge[], userId: string): Promise<Map<string, Set<string>>> {
    const strip = (t: string) => t.replace(/"/g, "");
    const ids = new Map<string, Set<string>>([["user", new Set([userId])]]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of edges) {
        const parentIds = ids.get(strip(e.parent));
        if (!parentIds || parentIds.size === 0) continue;
        const rows = await db.prisma.$queryRawUnsafe<{ id: string }[]>(
          `SELECT ${ROW_KEY} AS id FROM ${e.child} t WHERE ${e.col}::text = ANY($1::text[])`, [...parentIds]);
        const set = ids.get(strip(e.child)) ?? new Set<string>();
        const before = set.size;
        for (const r of rows) set.add(r.id);
        ids.set(strip(e.child), set);
        if (set.size > before) grew = true;
      }
    }
    return ids;
  }

  it("AC23 — every table reachable from user is emptied of the victim's rows; no unexpected non-cascade edge", async () => {
    const victim = await insertUser(db);
    const global = await insertExercise(db);
    await fullAccount(victim, global);
    await softDelete(victim, GRACE_S + 60);

    const edges = await fkEdges();
    const before = await victimRows(edges, victim);
    const reached = new Set(before.keys());
    for (const e of edges) {
      if (!reached.has(e.parent.replace(/"/g, ""))) continue;
      const key = `${e.child.replace(/"/g, "")}.${e.col}->${e.parent.replace(/"/g, "")}`;
      if (e.rule !== "c" && e.rule !== "n") expect(NON_CASCADE_ALLOWLIST, `non-cascade edge ${key}`).toContain(key);
    }
    for (const [table, set] of before) expect(set.size, `fixture has no ${table} rows (vacuous)`).toBeGreaterThan(0);

    const summary = await runPurge(db.prisma, silent, { confirm: true, skipGrace: false });
    expect(summary).toMatchObject({ purged: 1, skipped: 0, failed: 0 });

    for (const [table, set] of before) {
      const left = await db.prisma.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM "${table}" t WHERE ${ROW_KEY} = ANY($1::text[])`, [...set]);
      expect(left[0]!.n, `${table} rows left`).toBe(0);
    }
  });

  it("AC24 — a bystander sharing a global exercise is byte-identical; the global catalog is unchanged (Review Focus 4)", async () => {
    const victim = await insertUser(db);
    const bystander = await insertUser(db);
    const global = await insertExercise(db);
    await fullAccount(victim, global);
    await fullAccount(bystander, global);
    await softDelete(victim, GRACE_S + 60);
    // Discovered, not hand-listed: every table reachable from the bystander (as AC23 does for the
    // victim), each row set hashed by content, so a future table is covered too.
    const edges = await fkEdges();
    const bystanderRows = await victimRows(edges, bystander);
    const hashes = async () => {
      const perTable: Record<string, unknown> = {};
      for (const [table, set] of bystanderRows) {
        expect(set.size, `fixture has no bystander ${table} rows (vacuous)`).toBeGreaterThan(0);
        perTable[table] = await db.prisma.$queryRawUnsafe(
          `SELECT count(*)::int AS n, md5(string_agg(to_jsonb(t)::text, ',' ORDER BY ${ROW_KEY})) AS h FROM "${table}" t WHERE ${ROW_KEY} = ANY($1::text[])`,
          [...set],
        );
      }
      return {
        perTable,
        globalExercises: await db.prisma.$queryRawUnsafe(`SELECT md5(string_agg(to_jsonb(e)::text, ',' ORDER BY e.id)) h FROM "exercise" e WHERE owner_user_id IS NULL`),
        muscle: await tableHash(db, "muscle_group"),
        equipment: await tableHash(db, "equipment"),
      };
    };
    const before = await hashes();
    await runPurge(db.prisma, silent, { confirm: true, skipGrace: false });
    expect(await hashes()).toEqual(before);
    expect(await exists(bystander)).toBe(true);
  });

  it("AC21 — the dry run lists eligible accounts with counts, deletes nothing", async () => {
    const [a, b, c] = [await insertUser(db), await insertUser(db), await insertUser(db)];
    const global = await insertExercise(db);
    for (const u of [a, b, c]) await fullAccount(u, global);
    await softDelete(a, GRACE_S + 60);
    await softDelete(b, GRACE_S + 120);
    await softDelete(c, 60); // in grace
    const summary = await runPurge(db.prisma, silent, { confirm: false, skipGrace: false });
    expect(summary.dryRun).toBe(true);
    expect(summary.listed.map((x) => x.userId).sort()).toEqual([a, b].sort());
    expect(summary.listed.every((x) => x.workoutCount === 2 && x.setCount === 2)).toBe(true); // the routine-started workout has no sets yet
    for (const u of [a, b, c]) expect(await exists(u)).toBe(true);
  });

  it("AC25 — grace boundary is exact in seconds", async () => {
    const over = await insertUser(db);
    const under = await insertUser(db);
    await softDelete(over, GRACE_S + 1);
    await softDelete(under, GRACE_S - 1);
    const summary = await runPurge(db.prisma, silent, { confirm: true, skipGrace: false });
    expect(summary.purged).toBe(1);
    expect(await exists(over)).toBe(false);
    expect(await exists(under)).toBe(true);
  });

  it.each([
    { confirm: true, user: false, skipGrace: false },
    { confirm: true, user: true, skipGrace: false },
    { confirm: true, user: true, skipGrace: true },
    { confirm: false, user: true, skipGrace: true },
  ])("AC26 — a live account is never purged: %o", async ({ confirm, user, skipGrace }) => {
    const live = await insertUser(db);
    const summary = await runPurge(db.prisma, silent, { confirm, skipGrace, ...(user ? { userId: live } : {}) });
    expect(await exists(live)).toBe(true);
    expect(summary.purged).toBe(0);
    if (user) expect(summary.targetMissed).toBe(true);
  });

  it("AC27 — a restore after the dry run, or between listing and DELETE, is respected", async () => {
    const u = await insertUser(db);
    await softDelete(u, GRACE_S + 60);
    expect((await runPurge(db.prisma, silent, { confirm: false, skipGrace: false })).listed).toHaveLength(1);
    await db.prisma.$executeRawUnsafe(`UPDATE "user" SET deleted_at = NULL WHERE id = $1::uuid`, u);
    expect((await runPurge(db.prisma, silent, { confirm: true, skipGrace: false })).purged).toBe(0);
    expect(await exists(u)).toBe(true);

    await softDelete(u, GRACE_S + 60);
    const summary = await runPurge(db.prisma, silent, { confirm: true, skipGrace: false }, {
      beforeDelete: async (id) => {
        await db.prisma.$executeRawUnsafe(`UPDATE "user" SET deleted_at = NULL WHERE id = $1::uuid`, id);
      },
    });
    expect(summary).toMatchObject({ purged: 0, skipped: 1, failed: 0 });
    expect(await exists(u)).toBe(true);
  });

  it("AC28 (core) — --user --skip-grace purges an in-grace account; without --skip-grace it is skipped", async () => {
    const u = await insertUser(db);
    await softDelete(u, 60);
    expect((await runPurge(db.prisma, silent, { confirm: true, userId: u, skipGrace: false })).targetMissed).toBe(true);
    expect(await exists(u)).toBe(true);
    expect((await runPurge(db.prisma, silent, { confirm: true, userId: u, skipGrace: true })).purged).toBe(1);
    expect(await exists(u)).toBe(false);
  });

  it("AC22 — the advisory lock is the transaction's first statement; the DELETE carries the predicate; timeout 60 s", async () => {
    const u = await insertUser(db);
    await softDelete(u, GRACE_S + 60);
    const seen: string[] = [];
    (db.prisma as unknown as { $on: (ev: "query", cb: (e: { query: string }) => void) => void }).$on("query", (e) => seen.push(e.query));
    // A pass-through proxy records the transaction options without mutating the
    // shared client (vi.spyOn on a Prisma client breaks $transaction for later tests).
    const txOptions: unknown[] = [];
    const watched = new Proxy(db.prisma, {
      get(target, prop) {
        if (prop === "$transaction") {
          return (fn: unknown, options: unknown) => {
            txOptions.push(options);
            return (target.$transaction as (f: unknown, o: unknown) => unknown)(fn, options);
          };
        }
        const value = Reflect.get(target, prop, target) as unknown;
        return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
      },
    });
    seen.length = 0;
    await runPurge(watched, silent, { confirm: true, skipGrace: false });
    const inTx = seen.slice(seen.findIndex((q) => /^BEGIN/i.test(q)) + 1).filter((q) => !/^\s*(SET TRANSACTION|COMMIT)/i.test(q));
    expect(inTx[0]).toMatch(/pg_advisory_xact_lock/);
    expect(inTx.find((q) => /DELETE FROM "user"/.test(q))).toMatch(/deleted_at IS NOT NULL[\s\S]*make_interval/);
    expect(txOptions[0]).toMatchObject({ timeout: 60_000 });
  });

  it("AC29 — a failure on one account rolls it back and the run continues", async () => {
    const [a, b, c] = [await insertUser(db), await insertUser(db), await insertUser(db)];
    await softDelete(a, GRACE_S + 300);
    await softDelete(b, GRACE_S + 200);
    await softDelete(c, GRACE_S + 100);
    const summary = await runPurge(db.prisma, silent, { confirm: true, skipGrace: false }, {
      beforeDelete: async (id) => {
        if (id === b) throw new Error("injected");
      },
    });
    expect(summary).toMatchObject({ purged: 2, skipped: 0, failed: 1 });
    expect([await exists(a), await exists(b), await exists(c)]).toEqual([false, true, false]);
  });

  it("AC28 / AC31 — main: exit codes and PII-free output", async () => {
    const { main } = await import("../../src/account/purge-cli.js");
    const lines: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => { lines.push(String(s)); return true; });
    const u = await insertUser(db); // email u@ex.com
    await softDelete(u, GRACE_S + 60);
    // Testcontainers Postgres has no TLS, so reuse the test client via the seam.
    const env = { DATABASE_URL: db.url, LOG_LEVEL: "info" };
    const seam = { makePrisma: () => db.prisma };
    expect(await main([], env, seam)).toBe(0); // dry run
    expect(await main(["--confirm", "--user", uuidv7()], env, seam)).toBe(1); // unknown target
    expect(await main(["--confirm"], env, seam)).toBe(0);
    expect(await exists(u)).toBe(false);
    write.mockRestore();
    const out = lines.join("");
    expect(out).toContain("account_purge_eligible");
    expect(out).toContain("account_purged");
    expect(out).toMatch(/purged 1, skipped 0, failed 0/);
    expect(out).not.toMatch(/u@ex\.com|auth0\|/);
  });

  it("AC30 — no deadlock against live writers on the same user (repository level, ×10)", async () => {
    for (let i = 0; i < 10; i++) {
      const u = await insertUser(db);
      const ex = await insertExercise(db, { ownerUserId: u });
      const done = await logWorkout(db, u, { startedAt: daysAgo(3), exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
      const live = await logWorkout(db, u, { startedAt: new Date(Date.now() - 60_000), finish: "none", exercises: [{ exerciseId: ex, sets: [{ reps: 5, weight: 5 }] }] });
      const [weRow] = await db.prisma.$queryRawUnsafe<{ we: string }[]>(`SELECT id::text AS we FROM "workout_exercise" WHERE workout_id = $1::uuid`, live.workoutId);
      const we = weRow!.we;
      await softDelete(u, GRACE_S + 60);
      const results = await Promise.allSettled([
        runPurge(db.prisma, silent, { confirm: true, userId: u, skipGrace: false }),
        workouts().updateWorkout(u, live.workoutId, { endedAt: new Date().toISOString() }),
        workouts().createSet(u, we, { reps: 3, weight: 3, weightUnit: "kg", isComplete: true }),
        workouts().deleteWorkout(u, done.workoutId),
      ]);
      expect(results[0]!.status).toBe("fulfilled");
      for (const r of results.slice(1)) {
        if (r.status === "rejected") {
          // NotFound: the purge's DELETE won. (Spec 07.4: a set create that loses to the finish now
          // runs in finished mode instead of answering WorkoutFinished.) Anything else (a generic
          // Error, 40P01, a lock timeout) is a real failure.
          expect(["NotFoundError"], String(r.reason)).toContain((r.reason as Error).constructor.name);
        }
      }
      expect(await exists(u)).toBe(false);
      const orphans = await db.prisma.$queryRawUnsafe<{ n: number }[]>(`SELECT count(*)::int AS n FROM "personal_record" WHERE user_id = $1::uuid`, u);
      expect(orphans[0]!.n).toBe(0);
    }
  });
});
