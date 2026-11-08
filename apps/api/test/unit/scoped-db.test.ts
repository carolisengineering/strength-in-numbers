// apps/api/test/unit/scoped-db.test.ts
import { describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { parseUserId, type ExerciseId } from "@sin/core";
import { uuidv7 } from "uuidv7";
import { createScopedDb, toScoped } from "../../src/db/scoped.js";

/** One recorded raw statement: the SQL text with `?` placeholders and its values. */
interface Stmt {
  sql: string;
  values: unknown[];
}

/**
 * A fake root client. A raw call returns a marker (it does not run), the way a Prisma batch entry is lazy; `$transaction`
 * runs an array as one batch (each entry's statement recorded in order, results returned as an array) or a callback
 * against a transaction client that records statements in the same log.
 */
class FakePrisma {
  log: (Stmt | "BEGIN" | "BATCH" | "COMMIT")[] = [];
  txOptions: unknown[] = [];
  results = new Map<string, unknown>();

  private stmt(strings: TemplateStringsArray, values: unknown[]): Stmt & { pending: true } {
    return { sql: strings.join("?"), values, pending: true };
  }
  private run(s: Stmt): unknown {
    this.log.push({ sql: s.sql, values: s.values });
    return this.results.get(s.sql) ?? [];
  }

  $queryRaw = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const s = this.stmt(strings, values);
    // Lazy like a PrismaPromise: a bare call runs only when awaited; a batch entry is run by `$transaction`.
    return { __stmt: s, then: (ok: (v: unknown) => unknown, err?: (e: unknown) => unknown) => Promise.resolve().then(() => this.run(s)).then(ok, err) };
  };
  $executeRaw = this.$queryRaw;

  $transaction = async (arg: unknown, opts?: unknown): Promise<unknown> => {
    this.txOptions.push(opts);
    if (Array.isArray(arg)) {
      this.log.push("BATCH");
      const out = (arg as { __stmt: Stmt }[]).map((p) => this.run(p.__stmt));
      this.log.push("COMMIT");
      return out;
    }
    this.log.push("BEGIN");
    const tx = {
      $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(this.run({ sql: strings.join("?"), values })),
      $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise.resolve(this.run({ sql: strings.join("?"), values })),
    };
    const out = await (arg as (tx: unknown) => Promise<unknown>)(tx);
    this.log.push("COMMIT");
    return out;
  };

  /** The statements only (no markers). */
  get statements(): Stmt[] {
    return this.log.filter((e): e is Stmt => typeof e === "object");
  }
}

const asPrisma = (f: FakePrisma) => f as unknown as PrismaClient;
const SET_USER = "SELECT set_config('app.user_id', ?, true)";
const SET_SUB = "SELECT set_config('app.auth_sub', ?, true)";

describe("Spec 21.1 AC9 — one handle, two entry points", () => {
  it("as() with a malformed id throws before any database call", () => {
    const fake = new FakePrisma();
    const db = createScopedDb(asPrisma(fake));
    expect(() => db.as("not-a-uuid")).toThrow();
    expect(fake.log).toEqual([]);
  });

  it("a bare scoped $queryRaw is one batch of [set_config(app.user_id), statement]", async () => {
    const fake = new FakePrisma();
    const id = parseUserId(uuidv7());
    fake.results.set("SELECT ? AS n", [{ n: 7 }]);
    const rows = await createScopedDb(asPrisma(fake)).as(id).$queryRaw`SELECT ${7} AS n`;
    expect(fake.log).toEqual(["BATCH", { sql: SET_USER, values: [id] }, { sql: "SELECT ? AS n", values: [7] }, "COMMIT"]);
    expect(rows).toEqual([{ n: 7 }]); // the statement's result, not the batch array
  });

  it("a bare scoped $executeRaw is the same batch and returns the statement's count", async () => {
    const fake = new FakePrisma();
    const id = parseUserId(uuidv7());
    fake.results.set('DELETE FROM "x" WHERE id = ?', 3);
    const count = await createScopedDb(asPrisma(fake)).as(id).$executeRaw`DELETE FROM "x" WHERE id = ${"a"}`;
    expect(fake.statements.map((s) => s.sql)).toEqual([SET_USER, 'DELETE FROM "x" WHERE id = ?']);
    expect(count).toBe(3);
  });

  it("forAuthSub() sets app.auth_sub instead", async () => {
    const fake = new FakePrisma();
    await createScopedDb(asPrisma(fake)).forAuthSub("auth0|abc").$queryRaw`SELECT 1`;
    expect(fake.statements[0]).toEqual({ sql: SET_SUB, values: ["auth0|abc"] });
  });

  it("shared() runs the statement on the root client with no transaction and no setting", async () => {
    const fake = new FakePrisma();
    await createScopedDb(asPrisma(fake)).shared().$queryRaw`SELECT 1`;
    expect(fake.log).toEqual([{ sql: "SELECT 1", values: [] }]);
    expect(fake.txOptions).toEqual([]);
  });

  it("a scoped $transaction sends set_config first, then hands the callback the ordinary transaction client", async () => {
    const fake = new FakePrisma();
    const id = parseUserId(uuidv7());
    const out = await createScopedDb(asPrisma(fake))
      .as(id)
      .$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE "x" SET a = 1`;
        return "done";
      });
    expect(out).toBe("done");
    expect(fake.log).toEqual(["BEGIN", { sql: SET_USER, values: [id] }, { sql: 'UPDATE "x" SET a = 1', values: [] }, "COMMIT"]);
  });

  it("readOnly puts SET TRANSACTION READ ONLY before set_config", async () => {
    const fake = new FakePrisma();
    await createScopedDb(asPrisma(fake))
      .as(parseUserId(uuidv7()))
      .$transaction(async () => undefined, { readOnly: true });
    expect(fake.statements.map((s) => s.sql)).toEqual(["SET TRANSACTION READ ONLY", SET_USER]);
  });

  it("forwards isolationLevel, maxWait and timeout to the root $transaction, and nothing else", async () => {
    const fake = new FakePrisma();
    await createScopedDb(asPrisma(fake))
      .as(parseUserId(uuidv7()))
      .$transaction(async () => undefined, { isolationLevel: "RepeatableRead", readOnly: true, maxWait: 10_000, timeout: 60_000 });
    expect(fake.txOptions).toEqual([{ isolationLevel: "RepeatableRead", maxWait: 10_000, timeout: 60_000 }]);
  });

  it("with no options, the root $transaction gets no option keys (Prisma's defaults apply, as today)", async () => {
    const fake = new FakePrisma();
    await createScopedDb(asPrisma(fake))
      .as(parseUserId(uuidv7()))
      .$transaction(async () => undefined);
    expect(fake.txOptions).toEqual([{}]);
  });

  it("a scoped call accepts an unbranded string id (the repositories' actingUserId) after checking its shape", async () => {
    const fake = new FakePrisma();
    const id: string = uuidv7();
    await createScopedDb(asPrisma(fake)).as(id).$queryRaw`SELECT 1`;
    expect(fake.statements[0]).toEqual({ sql: SET_USER, values: [id] });
  });

  it("an empty auth_sub throws before any database call", () => {
    const fake = new FakePrisma();
    expect(() => createScopedDb(asPrisma(fake)).forAuthSub("")).toThrow();
    expect(fake.log).toEqual([]);
  });

  it("createScopedDb is scoped; toScoped of a bare client is not", () => {
    const fake = new FakePrisma();
    expect(createScopedDb(asPrisma(fake)).scoped).toBe(true);
    expect(toScoped(asPrisma(fake)).scoped).toBe(false);
  });

  it("toScoped returns a scoped handle as it is", () => {
    const db = createScopedDb(asPrisma(new FakePrisma()));
    expect(toScoped(db)).toBe(db);
  });

  it("toScoped(bare client).as(id) sends no setting: a bare call runs straight on the root client", async () => {
    const fake = new FakePrisma();
    await toScoped(asPrisma(fake)).as(parseUserId(uuidv7())).$queryRaw`SELECT 1`;
    expect(fake.log).toEqual([{ sql: "SELECT 1", values: [] }]);
  });

  it("toScoped(bare client) still checks the id, honors readOnly and forwards the options", async () => {
    const fake = new FakePrisma();
    const db = toScoped(asPrisma(fake));
    expect(() => db.as("nope")).toThrow();
    await db.as(parseUserId(uuidv7())).$transaction(async () => undefined, { readOnly: true, timeout: 30_000 });
    expect(fake.statements.map((s) => s.sql)).toEqual(["SET TRANSACTION READ ONLY"]);
    expect(fake.txOptions).toEqual([{ timeout: 30_000 }]);
  });

  it("Review Focus 4 — as() refuses a differently-branded id at compile time", () => {
    const db = createScopedDb(asPrisma(new FakePrisma()));
    const exerciseId = uuidv7() as ExerciseId;
    // @ts-expect-error — an ExerciseId is not who is asking
    expect(() => db.as(exerciseId)).not.toThrow();
  });
});
