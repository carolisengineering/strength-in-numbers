// apps/api/test/integration/app-role-grants.integration.test.ts
import type { Prisma } from "@prisma/client";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rawSqlState } from "../../src/repositories/pg-errors.js";
import { APP_GRANTS } from "./app-grants.js";
import { insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { logWorkout } from "./records-helpers.js";

/**
 * Spec 21.1 AC21, AC22 — what `sin_app` can do, proven as `sin_app`. The grants are checked on the migrated database
 * (RLS off, as `0020` leaves it). For AC21 this file enables RLS on four tables inside its own container; Phase D proves
 * it on the migrated schema.
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.1 — sin_app's grants and fail-closed policies (real Postgres)", () => {
  let db: AppIntegrationDb;

  async function sqlstateOf(sql: string): Promise<string | null> {
    try {
      await db.app.$executeRawUnsafe(sql);
      return null;
    } catch (err) {
      return rawSqlState(err);
    }
  }

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  describe("AC22 — the grants are exactly the allow-list", () => {
    it("table privileges equal APP_GRANTS, with nothing extra", async () => {
      const rows = await db.prisma.$queryRaw<{ table_name: string; privilege_type: string }[]>`
        SELECT table_name, privilege_type FROM information_schema.role_table_grants
        WHERE grantee = 'sin_app' ORDER BY 1, 2`;
      const seen: Record<string, string[]> = {};
      for (const r of rows) (seen[r.table_name] ??= []).push(r.privilege_type);
      const expected = Object.fromEntries(Object.entries(APP_GRANTS).map(([t, g]) => [t, [...g.table].sort()]));
      expect(seen).toEqual(expected);
    });

    it("column UPDATE privileges on user and exercise equal APP_GRANTS", async () => {
      for (const table of ["user", "exercise"]) {
        const rows = await db.prisma.$queryRaw<{ column_name: string }[]>`
          SELECT column_name FROM information_schema.column_privileges
          WHERE grantee = 'sin_app' AND table_name = ${table} AND privilege_type = 'UPDATE' ORDER BY 1`;
        expect([table, rows.map((r) => r.column_name)]).toEqual([table, [...APP_GRANTS[table]!.columns!.UPDATE].sort()]);
      }
    });

    it("the schema gives USAGE, not CREATE", async () => {
      const [p] = await db.prisma.$queryRaw<{ usage: boolean; create: boolean }[]>`
        SELECT has_schema_privilege('sin_app', 'public', 'USAGE') AS usage, has_schema_privilege('sin_app', 'public', 'CREATE') AS create`;
      expect(p).toEqual({ usage: true, create: false });
    });

    const REFUSED = [
      `CREATE TABLE public.probe (x int)`,
      `SELECT * FROM _prisma_migrations`,
      `DELETE FROM "user"`,
      `DELETE FROM "exercise"`,
      `UPDATE "muscle_group" SET name = name`,
      `UPDATE "equipment" SET name = name`,
      `UPDATE "exercise" SET owner_user_id = owner_user_id`,
      `UPDATE "exercise" SET id = id`,
      `UPDATE "exercise" SET catalog_key = catalog_key`,
      `UPDATE "user" SET id = id`,
      `UPDATE "user" SET auth_sub = auth_sub`,
    ];
    for (const sql of REFUSED) {
      it(`refused (42501): ${sql}`, async () => {
        expect(await sqlstateOf(sql)).toBe("42501");
      });
    }
  });

  describe("AC22 — no role to escape into", () => {
    it("sin_app is a member of nothing", async () => {
      const rows = await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM pg_auth_members WHERE member = 'sin_app'::regrole`;
      expect(rows[0]!.n).toBe(0n);
    });

    it("SET ROLE to the container's superuser and to every BYPASSRLS role fails", async () => {
      const roles = await db.prisma.$queryRaw<{ rolname: string }[]>`SELECT rolname FROM pg_roles WHERE rolbypassrls OR rolsuper`;
      const names = new Set([new URL(db.url).username, ...roles.map((r) => r.rolname)]);
      expect(names.size).toBeGreaterThan(0);
      for (const role of names) expect([role, await sqlstateOf(`SET ROLE "${role}"`)]).toEqual([role, "42501"]);
    });
  });

  describe("AC21 — fail closed, with RLS enabled on four tables in this container", () => {
    let a: { user: string; workout: string; exercise: string };
    let b: { user: string; workout: string; exercise: string };
    let globalExercise: string;
    type Tx = Prisma.TransactionClient;

    /** On `sin_app`, in one transaction, with `app.user_id` in the given state (`null` = never set). */
    const asApp = <T>(who: string | null, run: (tx: Tx) => Promise<T>) =>
      db.app.$transaction(async (tx) => {
        if (who !== null) await tx.$queryRaw`SELECT set_config('app.user_id', ${who}, true)`;
        return run(tx);
      });

    const visible = (who: string | null) =>
      asApp(who, async (tx) => ({
        users: (await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "user"`).map((r) => r.id).sort(),
        workouts: (await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "workout"`).map((r) => r.id).sort(),
        sets: (await tx.$queryRaw<{ user_id: string }[]>`SELECT user_id::text FROM "set_entry"`).map((r) => r.user_id),
        exercises: (await tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "exercise"`).map((r) => r.id).sort(),
      }));

    const seed = async () => {
      const user = await insertUser(db);
      const exercise = await insertExercise(db, { ownerUserId: user });
      const { workoutId } = await logWorkout(db, user, { startedAt: new Date(Date.now() - 86_400_000), exercises: [{ exerciseId: exercise, sets: [{ reps: 5, weight: 100 }] }] });
      return { user, workout: workoutId, exercise };
    };

    beforeAll(async () => {
      if (!shouldRunIntegration()) return;
      a = await seed();
      b = await seed();
      globalExercise = await insertExercise(db);
      for (const table of ["user", "exercise", "workout", "set_entry"]) {
        await db.prisma.$executeRawUnsafe(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      }
    }, 60_000);

    for (const [label, who] of [["unset", null], ["set to ''", ""]] as const) {
      it(`app.user_id ${label}: no user's rows, only the shared exercises`, async () => {
        expect(await visible(who)).toEqual({ users: [], workouts: [], sets: [], exercises: [globalExercise] });
      });
    }

    it("app.user_id = A: A's rows and the shared exercises; never B's", async () => {
      const seen = await visible(a.user);
      expect(seen.users).toEqual([a.user]);
      expect(seen.workouts).toEqual([a.workout]);
      expect(seen.sets).toEqual([a.user]);
      expect(seen.exercises).toEqual([a.exercise, globalExercise].sort());
    });

    it("app.user_id = B: B's rows and the shared exercises; never A's", async () => {
      const seen = await visible(b.user);
      expect(seen.users).toEqual([b.user]);
      expect(seen.workouts).toEqual([b.workout]);
      expect(seen.sets).toEqual([b.user]);
      expect(seen.exercises).toEqual([b.exercise, globalExercise].sort());
    });

    it("a non-uuid value raises 22P02 rather than returning rows", async () => {
      await expect(asApp("abc", (tx) => tx.$queryRaw`SELECT id FROM "workout"`)).rejects.toMatchObject({ meta: { code: "22P02" } });
    });

    const notesOf = async (id: string) => (await db.prisma.$queryRaw<{ notes: string | null }[]>`SELECT notes FROM "workout" WHERE id = ${id}::uuid`)[0]!.notes;
    const setsOf = async (user: string) => (await db.prisma.$queryRaw<{ n: bigint }[]>`SELECT count(*) AS n FROM "set_entry" WHERE user_id = ${user}::uuid`)[0]!.n;

    it("an UPDATE with no WHERE changes only the set user's rows; unset changes nothing", async () => {
      expect(await asApp(null, (tx) => tx.$executeRaw`UPDATE "workout" SET notes = 'unset'`)).toBe(0);
      expect(await asApp(a.user, (tx) => tx.$executeRaw`UPDATE "workout" SET notes = 'as-a'`)).toBe(1);
      expect(await notesOf(a.workout)).toBe("as-a");
      expect(await notesOf(b.workout)).not.toBe("as-a");
    });

    it("a DELETE with no WHERE removes only the set user's rows; '' removes nothing", async () => {
      expect(await asApp("", (tx) => tx.$executeRaw`DELETE FROM "set_entry"`)).toBe(0);
      expect(await asApp(a.user, (tx) => tx.$executeRaw`DELETE FROM "set_entry"`)).toBe(1);
      expect(await setsOf(a.user)).toBe(0n);
      expect(await setsOf(b.user)).toBe(1n);
    });

    it("an INSERT of a workout for B while A is set is refused (42501)", async () => {
      let state: string | null = null;
      try {
        await asApp(a.user, (tx) => tx.$executeRaw`
          INSERT INTO "workout" (id, user_id, started_at, local_date, tz_offset_minutes, client_generated_id, source, created_at, updated_at)
          VALUES (${uuidv7()}::uuid, ${b.user}::uuid, now(), CURRENT_DATE, 0, ${uuidv7()}::uuid, 'manual', now(), now())`);
      } catch (err) {
        state = rawSqlState(err);
      }
      expect(state).toBe("42501");
    });

    it("provisioning: a row is visible by app.auth_sub only for that subject, and insertable only for it", async () => {
      const sub = (await db.prisma.$queryRaw<{ auth_sub: string }[]>`SELECT auth_sub FROM "user" WHERE id = ${a.user}::uuid`)[0]!.auth_sub;
      const seen = await db.app.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.auth_sub', ${sub}, true)`;
        return tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "user"`;
      });
      expect(seen.map((r) => r.id)).toEqual([a.user]);
      let state: string | null = null;
      try {
        await db.app.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT set_config('app.auth_sub', ${sub}, true)`;
          await tx.$executeRaw`INSERT INTO "user" (id, auth_sub, email) VALUES (${uuidv7()}::uuid, ${"auth0|someone-else"}, 'x@ex.com')`;
        });
      } catch (err) {
        state = rawSqlState(err);
      }
      expect(state).toBe("42501");
    });

    it("a shared exercise can be locked FOR SHARE (the Hevy import) but not written", async () => {
      const locked = await asApp(a.user, (tx) => tx.$queryRaw<{ id: string }[]>`SELECT id::text FROM "exercise" WHERE id = ${globalExercise}::uuid FOR SHARE`);
      expect(locked.map((r) => r.id)).toEqual([globalExercise]);
      let state: string | null = null;
      try {
        await asApp(a.user, (tx) => tx.$executeRaw`UPDATE "exercise" SET name = 'Mine now' WHERE id = ${globalExercise}::uuid`);
      } catch (err) {
        state = rawSqlState(err);
      }
      expect(state).toBe("42501");
    });
  });
});
