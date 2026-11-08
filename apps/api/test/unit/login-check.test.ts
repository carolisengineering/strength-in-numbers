// apps/api/test/unit/login-check.test.ts
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { ConfigError } from "../../src/config.js";
import { assertLoginCannotBypassRls, DatabaseLoginRejectedError, DatabaseUnreachableError, UnsafeDatabaseLoginError } from "../../src/db/login-check.js";
import { startupFailureMessage } from "../../src/startup-failure.js";

/** Spec 21.1 AC24, AC26 — the verdicts and the retry, with a fake client and a fake clock. */

interface RoleRow {
  rolname: string;
  rolsuper: boolean;
  rolbypassrls: boolean;
  owns_table: boolean;
}
const CLEAN: RoleRow = { rolname: "sin_app", rolsuper: false, rolbypassrls: false, owns_table: false };

function fake(opts: { login?: Partial<RoleRow>; members?: RoleRow[]; rowSecurity?: string; failures?: unknown[] } = {}) {
  const failures = [...(opts.failures ?? [])];
  const calls = { login: 0, members: 0, rowSecurity: 0 };
  const client = {
    $queryRaw: (strings: TemplateStringsArray) => {
      const sql = strings.join("?");
      const failure = failures.shift();
      if (failure !== undefined) return Promise.reject(failure instanceof Error ? failure : new Error(String(failure)));
      if (sql.includes("pg_has_role")) {
        calls.members += 1;
        return Promise.resolve(opts.members ?? []);
      }
      if (sql.includes("row_security")) {
        calls.rowSecurity += 1;
        return Promise.resolve([{ row_security: opts.rowSecurity ?? "on" }]);
      }
      calls.login += 1;
      return Promise.resolve([{ ...CLEAN, ...opts.login }]);
    },
  } as unknown as Pick<PrismaClient, "$queryRaw">;
  return { client, calls };
}

function fakeClock() {
  let t = 0;
  const sleeps: number[] = [];
  return {
    sleeps,
    now: () => t,
    sleep: (ms: number) => {
      sleeps.push(ms);
      t += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => void (t += ms),
  };
}

const unreachable = () => new Prisma.PrismaClientKnownRequestError("Can't reach database server", { code: "P1001", clientVersion: "test" });

const message = (role: string, reason: string) =>
  `Refusing to start: the database login "${role}" can bypass row-level security (${reason}). The API must connect as the restricted application login (see docs/runbooks/first-deploy.md, RLS rollout). Maintenance commands use OWNER_DATABASE_URL.`;

describe("Spec 21.1 AC24 — the verdict: each reason, in order, with the exact message", () => {
  const cases: [string, Parameters<typeof fake>[0], string][] = [
    ["superuser", { login: { rolsuper: true } }, "superuser"],
    ["BYPASSRLS", { login: { rolbypassrls: true } }, "has BYPASSRLS"],
    ["owns tables", { login: { owns_table: true } }, "owns application tables"],
    ["can SET ROLE", { members: [{ rolname: "t_bypass", rolsuper: false, rolbypassrls: true, owns_table: false }] }, 'can SET ROLE to "t_bypass"'],
    ["row_security off", { rowSecurity: "off" }, "row_security is off"],
  ];
  for (const [label, opts, reason] of cases) {
    it(`${label}: refuses at once, with no retry and no sleep`, async () => {
      const { client, calls } = fake(opts);
      const clock = fakeClock();
      const err = await assertLoginCannotBypassRls(client, clock).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UnsafeDatabaseLoginError);
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as UnsafeDatabaseLoginError).message).toBe(message("sin_app", reason));
      expect((err as UnsafeDatabaseLoginError).reason).toBe(reason);
      expect(calls).toEqual({ login: 1, members: 1, rowSecurity: 1 });
      expect(clock.sleeps).toEqual([]);
    });
  }

  it("the first hit wins: a superuser that also owns tables reads as superuser", async () => {
    const err = await assertLoginCannotBypassRls(fake({ login: { rolsuper: true, owns_table: true } }).client, fakeClock()).catch((e: unknown) => e);
    expect((err as UnsafeDatabaseLoginError).reason).toBe("superuser");
  });

  it("startupFailureMessage prints the one line and a newline, no stack", async () => {
    const err = await assertLoginCannotBypassRls(fake({ login: { rolsuper: true } }).client, fakeClock()).catch((e: unknown) => e);
    expect(startupFailureMessage(err)).toBe(`${message("sin_app", "superuser")}\n`);
  });

  it("a clean login resolves with its facts", async () => {
    const facts = await assertLoginCannotBypassRls(fake().client, fakeClock());
    expect(facts).toMatchObject({ role: "sin_app", superuser: false, bypassrls: false, ownsTables: false, memberOfBypass: [], rowSecurity: true });
    expect(typeof facts.ms).toBe("number");
  });
});

describe("Spec 21.1 AC26 — connectivity is not a verdict", () => {
  it("two connection failures, then clean rows: resolves after sleeping 250 then 500", async () => {
    const clock = fakeClock();
    const { client } = fake({ failures: [unreachable(), unreachable()] });
    await expect(assertLoginCannotBypassRls(client, clock)).resolves.toMatchObject({ role: "sin_app" });
    expect(clock.sleeps).toEqual([250, 500]);
  });

  it("an initialization error that is not a rejected login is retried too", async () => {
    const clock = fakeClock();
    const { client } = fake({ failures: [new Prisma.PrismaClientInitializationError("Can't reach", "test", "P1001")] });
    await expect(assertLoginCannotBypassRls(client, clock)).resolves.toMatchObject({ role: "sin_app" });
    expect(clock.sleeps).toEqual([250]);
  });

  it("a pool timeout while Neon wakes up (P2024) is retried, not a verdict", async () => {
    const clock = fakeClock();
    const { client } = fake({ failures: [new Prisma.PrismaClientKnownRequestError("Timed out fetching a new connection", { code: "P2024", clientVersion: "test" })] });
    await expect(assertLoginCannotBypassRls(client, clock)).resolves.toMatchObject({ role: "sin_app" });
    expect(clock.sleeps).toEqual([250]);
  });

  it("final review I5 — giving up prints one fixed line with the error code: no host, no stack", async () => {
    const clock = fakeClock();
    const failures = Array.from({ length: 50 }, () => new Prisma.PrismaClientKnownRequestError("Can't reach database server at `ep-secret-host.neon.tech:5432`", { code: "P1001", clientVersion: "test" }));
    const err = await assertLoginCannotBypassRls(fake({ failures }).client, clock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnreachableError);
    expect(err).toBeInstanceOf(ConfigError);
    const line = startupFailureMessage(err);
    expect(line).toBe("Refusing to start: could not reach the database within 20 s (P1001).\n");
    expect(line).not.toContain("ep-secret-host");
  });

  it("an initialization error with no code names its class instead", async () => {
    const clock = fakeClock();
    const failures = Array.from({ length: 50 }, () => new Prisma.PrismaClientInitializationError("Can't reach `ep-secret-host:5432`", "test"));
    const err = await assertLoginCannotBypassRls(fake({ failures }).client, clock).catch((e: unknown) => e);
    expect((err as Error).message).toBe("Refusing to start: could not reach the database within 20 s (PrismaClientInitializationError).");
  });

  it("the backoff doubles up to 4 s; forever unreachable gives up once past 20 s", async () => {
    const clock = fakeClock();
    const failures = Array.from({ length: 50 }, unreachable);
    const { client } = fake({ failures });
    const err = await assertLoginCannotBypassRls(client, clock).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(DatabaseUnreachableError);
    expect(clock.sleeps.slice(0, 6)).toEqual([250, 500, 1000, 2000, 4000, 4000]);
    expect(Math.max(...clock.sleeps)).toBe(4000);
    expect(clock.sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(20_000);
  });

  for (const [label, error] of [
    ["P1000", new Prisma.PrismaClientInitializationError("Authentication failed", "test", "P1000")],
    ["P1000 (known request)", new Prisma.PrismaClientKnownRequestError("Authentication failed", { code: "P1000", clientVersion: "test" })],
    // What Prisma 6.19 really raises through $queryRaw for both a NOLOGIN role and a wrong password: no code at all.
    [
      "the real shape: an initialization error with no code",
      new Prisma.PrismaClientInitializationError(
        "\nInvalid `prisma.$queryRaw()` invocation:\n\n\nAuthentication failed against database server, the provided database credentials for `sin_app` are not valid.\n",
        "test",
      ),
    ],
    ["SQLSTATE 28000", new Prisma.PrismaClientKnownRequestError("x", { code: "P2010", clientVersion: "test", meta: { code: "28000" } })],
    ["SQLSTATE 28P01 in a cause", Object.assign(new Error("outer"), { cause: Object.assign(new Error("inner"), { code: "28P01" }) })],
  ] as const) {
    it(`Review Focus 4 — a rejected login (${label}) throws DatabaseLoginRejectedError at once, naming db:app-role`, async () => {
      const clock = fakeClock();
      const err = await assertLoginCannotBypassRls(fake({ failures: [error] }).client, clock).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DatabaseLoginRejectedError);
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("pnpm --filter @sin/api run db:app-role");
      expect(clock.sleeps).toEqual([]);
    });
  }

  it("anything else is rethrown at once", async () => {
    const clock = fakeClock();
    const boom = new TypeError("a bug");
    await expect(assertLoginCannotBypassRls(fake({ failures: [boom] }).client, clock)).rejects.toBe(boom);
    expect(clock.sleeps).toEqual([]);
  });
});
