// apps/api/test/integration/scoped-db.integration.test.ts
import { PrismaClient, type Prisma } from "@prisma/client";
import { parseUserId } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createScopedDb, type UserScopedDb } from "../../src/db/scoped.js";
import { isRawUniqueViolation, rawSqlState, type RawPrismaError } from "../../src/repositories/pg-errors.js";
import { shouldRunIntegration, startBareDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 21.1 AC10–AC13 — the scoped handle on real Postgres: the statement order Prisma's query events show, error and
 * value parity with a bare call (Review Focus 1, 5), the options reaching the root transaction (Review Focus 3), the
 * setting never outliving its transaction, and no cross-talk between users sharing a small pool.
 */
describe.skipIf(!shouldRunIntegration())("Spec 21.1 — the scoped handle on real Postgres", () => {
  let db: IntegrationDb;
  let one: PrismaClient; // connection_limit=1: what the handle leaves behind is visible to the next call
  let two: PrismaClient; // connection_limit=2: the concurrency case
  const events: string[] = [];

  const withLimit = (url: string, n: number) => `${url}${url.includes("?") ? "&" : "?"}connection_limit=${n}`;

  /** The query events of `run` alone (the root client runs nothing else meanwhile). */
  async function observe(run: () => Promise<unknown>): Promise<string[]> {
    events.length = 0;
    await run().catch(() => undefined);
    return events.map((q) => q.replace(/\s+/g, " ").trim());
  }

  async function failure(run: () => Promise<unknown>): Promise<RawPrismaError> {
    try {
      await run();
    } catch (error) {
      return error as RawPrismaError;
    }
    throw new Error("expected the statement to fail");
  }

  const user = () => parseUserId(uuidv7());

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startBareDb();
    one = new PrismaClient({ datasourceUrl: withLimit(db.url, 1) });
    two = new PrismaClient({ datasourceUrl: withLimit(db.url, 2) });
    await db.prisma.$executeRawUnsafe(`CREATE TABLE parent (id int PRIMARY KEY)`);
    await db.prisma.$executeRawUnsafe(
      `CREATE TABLE child (id int PRIMARY KEY, parent_id int NOT NULL REFERENCES parent(id), name text UNIQUE, n int CHECK (n >= 0))`,
    );
    await db.prisma.$executeRawUnsafe(`INSERT INTO parent VALUES (1)`);
    await db.prisma.$executeRawUnsafe(`INSERT INTO child VALUES (1, 1, 'taken', 0)`);
    db.prisma.$on("query" as never, (e: { query: string }) => void events.push(e.query));
  }, 120_000);

  afterAll(async () => {
    await one?.$disconnect();
    await two?.$disconnect();
    await db?.stop();
  });

  describe("AC10 — a bare scoped call is one short transaction", () => {
    it("issues BEGIN, set_config, the statement, COMMIT, in that order", async () => {
      const scoped = createScopedDb(db.prisma);
      const seen = await observe(() => scoped.as(user()).$queryRaw`SELECT id FROM parent WHERE id = ${1}`);
      expect(seen).toEqual(["BEGIN", "SELECT set_config('app.user_id', $1, true)", "SELECT id FROM parent WHERE id = $1", "COMMIT"]);
    });

    it("an $executeRaw takes the same shape and returns the same row count as a bare call", async () => {
      const scoped = createScopedDb(db.prisma);
      const seen = await observe(() => scoped.as(user()).$executeRaw`UPDATE parent SET id = id WHERE id = ${1}`);
      expect(seen[0]).toBe("BEGIN");
      expect(seen.at(-1)).toBe("COMMIT");
      const bare = await db.prisma.$executeRaw`UPDATE parent SET id = id WHERE id = ${1}`;
      const viaHandle = await scoped.as(user()).$executeRaw`UPDATE parent SET id = id WHERE id = ${1}`;
      expect(viaHandle).toBe(bare);
      expect(viaHandle).toBe(1);
    });

    // Review Focus 1: a 409 decided by a unique index, a 422 by an FK or CHECK, all read the same shape.
    const violations: [string, (c: Pick<Prisma.TransactionClient, "$executeRaw">) => Promise<unknown>][] = [
      ["23505 unique", (c) => c.$executeRaw`INSERT INTO child VALUES (${2}, 1, 'taken', 0)`],
      ["23503 foreign key", (c) => c.$executeRaw`INSERT INTO child VALUES (${3}, 99, 'x', 0)`],
      ["23514 check", (c) => c.$executeRaw`INSERT INTO child VALUES (${4}, 1, 'y', -1)`],
    ];
    for (const [label, run] of violations) {
      it(`Review Focus 1 — a ${label} violation reads identically bare and through the handle`, async () => {
        const bare = await failure(() => run(db.prisma));
        const scoped = await failure(() => run(createScopedDb(db.prisma).as(user())));
        expect(rawSqlState(scoped)).toBe(rawSqlState(bare));
        expect(rawSqlState(scoped)).toBe(label.slice(0, 5));
        expect(isRawUniqueViolation(scoped)).toBe(isRawUniqueViolation(bare));
        expect(scoped.code).toBe(bare.code);
        expect(scoped.meta).toEqual(bare.meta);
        expect(scoped.constructor).toBe(bare.constructor);
      });
    }

    it("Review Focus 5 — returned values keep their types: bigint stays bigint, timestamptz stays Date", async () => {
      const read = (c: Pick<Prisma.TransactionClient, "$queryRaw">) =>
        c.$queryRaw<{ n: bigint; t: Date; s: string; d: Prisma.Decimal }[]>`
          SELECT count(*) AS n, '2026-01-02T03:04:05.678Z'::timestamptz AS t, 'x'::text AS s, 1.5::numeric AS d
          FROM generate_series(1, 3)`;
      const bare = await read(db.prisma);
      const scoped = await read(createScopedDb(db.prisma).as(user()));
      expect(scoped).toEqual(bare);
      expect(typeof scoped[0]!.n).toBe("bigint");
      expect(scoped[0]!.t).toBeInstanceOf(Date);
      expect(scoped[0]!.d.constructor).toBe(bare[0]!.d.constructor);
    });
  });

  describe("AC11 — a scoped $transaction sets the user once, first", () => {
    it("the first statement after BEGIN is set_config, and the callback runs on the ordinary transaction client", async () => {
      const id = user();
      let inside: string | null = null;
      const seen = await observe(() =>
        createScopedDb(db.prisma)
          .as(id)
          .$transaction(async (tx) => {
            inside = (await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('app.user_id', true) AS v`)[0]!.v;
            await tx.$executeRaw`UPDATE parent SET id = id WHERE id = ${1}`;
          }),
      );
      expect(seen.slice(0, 2)).toEqual(["BEGIN", "SELECT set_config('app.user_id', $1, true)"]);
      expect(seen.at(-1)).toBe("COMMIT");
      expect(inside).toBe(id);
    });

    it("readOnly: SET TRANSACTION READ ONLY comes before set_config, and a write inside fails 25006", async () => {
      const seen = await observe(() =>
        createScopedDb(db.prisma)
          .as(user())
          .$transaction(async () => undefined, { readOnly: true }),
      );
      expect(seen.slice(0, 3)).toEqual(["BEGIN", "SET TRANSACTION READ ONLY", "SELECT set_config('app.user_id', $1, true)"]);
      const err = await failure(() =>
        createScopedDb(db.prisma)
          .as(user())
          .$transaction((tx) => tx.$executeRaw`UPDATE parent SET id = id`, { readOnly: true }),
      );
      expect(rawSqlState(err)).toBe("25006");
    });

    it("Review Focus 3 — isolationLevel, maxWait and timeout reach the root $transaction; the isolation level is the one asked for", async () => {
      const seenOptions: unknown[] = [];
      // vi.spyOn would replace a method on Prisma's own proxy (and break the client on restore): wrap it instead.
      const recording = new Proxy(db.prisma, {
        get(target, prop) {
          if (prop === "$transaction")
            return (fn: unknown, opts?: unknown) => {
              seenOptions.push(opts);
              return (target.$transaction as (f: unknown, o?: unknown) => Promise<unknown>)(fn, opts);
            };
          const value = Reflect.get(target, prop) as unknown;
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
        },
      });
      const level = await createScopedDb(recording)
        .as(user())
        .$transaction(
          async (tx) => (await tx.$queryRaw<{ l: string }[]>`SELECT current_setting('transaction_isolation') AS l`)[0]!.l,
          { isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 },
        );
      expect(level).toBe("repeatable read");
      expect(seenOptions).toEqual([{ isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 }]);
    });

    it("Review Focus 3 — a short timeout really applies (a callback that outlives it fails)", async () => {
      await expect(
        createScopedDb(db.prisma)
          .as(user())
          .$transaction(async (tx) => tx.$executeRaw`SELECT pg_sleep(0.5)`, { timeout: 100 }),
      ).rejects.toMatchObject({ code: "P2028" });
    });
  });

  describe("AC12 — the setting never outlives its transaction", () => {
    const leftOver = async () => (await one.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.user_id', true) AS v`)[0]!.v;
    const isEmpty = (v: string | null) => v === null || v === "";

    it("after a bare call, a transaction, a failed statement, a rollback and a throw inside the callback", async () => {
      const scoped: UserScopedDb = createScopedDb(one);
      await scoped.as(user()).$queryRaw`SELECT 1`;
      expect(isEmpty(await leftOver())).toBe(true);

      await scoped.as(user()).$transaction(async (tx) => tx.$queryRaw`SELECT 1`);
      expect(isEmpty(await leftOver())).toBe(true);

      await failure(() => scoped.as(user()).$executeRaw`INSERT INTO child VALUES (${9}, 1, 'taken', 0)`);
      expect(isEmpty(await leftOver())).toBe(true);

      await failure(() => scoped.as(user()).$transaction(async (tx) => tx.$executeRaw`INSERT INTO child VALUES (${9}, 99, 'z', 0)`));
      expect(isEmpty(await leftOver())).toBe(true);

      await failure(() =>
        scoped.as(user()).$transaction(async (tx) => {
          await tx.$queryRaw`SELECT 1`;
          throw new Error("callback threw");
        }),
      );
      expect(isEmpty(await leftOver())).toBe(true);

      await scoped.forAuthSub("auth0|someone").$queryRaw`SELECT 1`;
      expect(isEmpty((await one.$queryRaw<{ v: string | null }[]>`SELECT current_setting('app.auth_sub', true) AS v`)[0]!.v)).toBe(true);
    });
  });

  describe("AC13 — no cross-talk under concurrency", () => {
    it("200 interleaved scoped calls for 10 users on a pool of 2 each see their own id", async () => {
      const scoped = createScopedDb(two);
      const users = Array.from({ length: 10 }, user);
      const calls = Array.from({ length: 200 }, async (_, i) => {
        const id = users[i % users.length]!;
        const c = scoped.as(id);
        const seen =
          i % 2 === 0
            ? (await c.$queryRaw<{ v: string }[]>`SELECT current_setting('app.user_id', true) AS v`)[0]!.v
            : await c.$transaction(async (tx) => {
                await tx.$executeRaw`SELECT pg_sleep(0.001)`;
                return (await tx.$queryRaw<{ v: string }[]>`SELECT current_setting('app.user_id', true) AS v`)[0]!.v;
              });
        return { id, seen };
      });
      const results = await Promise.all(calls);
      expect(results.filter((r) => r.seen !== r.id)).toEqual([]);
      expect(results).toHaveLength(200);
    });
  });
});
