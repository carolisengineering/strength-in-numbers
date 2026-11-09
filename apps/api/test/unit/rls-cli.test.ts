// apps/api/test/unit/rls-cli.test.ts
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { OWNER_URL_MISSING } from "../../src/db/owner-url.js";
import { main, parseRlsArgs } from "../../src/db/rls-cli.js";
import { rlsStatus, warnIfRlsDisabled, type RlsCatalogClient } from "../../src/db/rls.js";
import { RLS_LOCK_ORDER, RLS_TABLES, quoteIdent } from "../../src/db/rls-tables.js";

const USAGE = "usage: db:rls -- status|enable|disable";
const OWNER = "postgresql://owner:owner-secret@127.0.0.1:5433/sin?sslmode=disable";

function io() {
  const lines = { out: "", err: "" };
  return { lines, io: { out: (s: string) => void (lines.out += s), err: (s: string) => void (lines.err += s) } };
}
const neverConnect = (): PrismaClient => {
  throw new Error("must not touch a database");
};

/** A client whose `pg_class` read reports the given tables as off. */
const fakeCatalog = (off: readonly string[]) =>
  ({
    $queryRaw: (strings: TemplateStringsArray) =>
      Promise.resolve(
        strings.join("").includes("current_database")
          ? [{ database: "neondb", login: "neondb_owner" }]
          : RLS_TABLES.map((relname) => ({ relname, relrowsecurity: !off.includes(relname) })),
      ),
  }) as unknown as RlsCatalogClient;

describe("Spec 21.1 AC39, Review Focus 5 — the argument never switches RLS by accident", () => {
  it.each([
    [["--", "disable"], "disable"],
    [["disable"], "disable"],
    [["--", "enable"], "enable"],
    [["enable"], "enable"],
    [["status"], "status"],
    [["--", "status"], "status"],
  ])("%j parses as %s", (argv, command) => {
    expect(parseRlsArgs(argv)).toEqual({ ok: true, command });
  });

  it.each([[["disabled"]], [[]], [["disable", "x"]], [["--"]], [["--", "--", "disable"]], [["DISABLE"]]])("%j is refused with the usage line", (argv) => {
    expect(parseRlsArgs(argv)).toEqual({ ok: false, error: USAGE });
  });

  it.each([[["disabled"]], [[]], [["disable", "x"]]])("main(%j) exits 1 with the usage line, without connecting", async (argv) => {
    const t = io();
    expect(await main(argv, { OWNER_DATABASE_URL: OWNER }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.err).toBe(`${USAGE}\n`);
  });
});

describe("Spec 21.1 AC39 — the owner login", () => {
  it("no owner URL: exit 1 with Phase C's message, without connecting", async () => {
    const t = io();
    expect(await main(["disable"], { DATABASE_URL: OWNER }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.err).toBe(`${OWNER_URL_MISSING}\n`);
  });

  it("a failure prints neither the password nor the host", async () => {
    const t = io();
    const failing = {
      $queryRaw: () => Promise.reject(new Error(`can't reach 127.0.0.1:5433 with ${OWNER} owner-secret`)),
      $disconnect: () => Promise.resolve(),
    } as unknown as PrismaClient;
    expect(await main(["status"], { OWNER_DATABASE_URL: OWNER }, { io: t.io, makePrisma: () => failing })).toBe(1);
    expect(t.lines.err).toContain("db:rls failed");
    expect(t.lines.err).not.toContain("owner-secret");
    expect(t.lines.err).not.toContain("127.0.0.1");
  });
});

describe("Spec 21.1 §4.1 — the table lists", () => {
  it("the lock order names exactly the 19 tables, parents before children", () => {
    expect(RLS_TABLES).toHaveLength(19);
    expect([...RLS_LOCK_ORDER].sort()).toEqual([...RLS_TABLES].sort());
    const at = (t: string) => RLS_LOCK_ORDER.indexOf(t);
    expect(at("routine")).toBeLessThan(at("workout"));
    expect(at("workout")).toBeLessThan(at("workout_exercise"));
    expect(at("workout_exercise")).toBeLessThan(at("set_entry"));
  });

  it("quoteIdent double-quotes a name and doubles any quote inside it", () => {
    expect(quoteIdent("user")).toBe('"user"');
    expect(quoteIdent('a"b')).toBe('"a""b"');
  });
});

describe("Spec 21.1 AC39 — status", () => {
  it("rlsStatus answers in RLS_TABLES order; a table the catalog does not list reads off", async () => {
    const client = {
      $queryRaw: () => Promise.resolve([{ relname: "equipment", relrowsecurity: true }, { relname: "user", relrowsecurity: true }]),
    } as unknown as RlsCatalogClient;
    const status = await rlsStatus(client);
    expect(status.map((s) => s.table)).toEqual(RLS_TABLES);
    expect(status.filter((s) => s.enabled).map((s) => s.table)).toEqual(["user", "equipment"]);
  });

  it("Review Focus 4 — status exits 0, and warns when any table is off", async () => {
    const t = io();
    const client = { ...fakeCatalog(["user", "workout"]), $disconnect: () => Promise.resolve() } as unknown as PrismaClient;
    expect(await main(["status"], { OWNER_DATABASE_URL: OWNER }, { io: t.io, makePrisma: () => client })).toBe(0);
    expect(t.lines.out.trimEnd().split("\n")).toHaveLength(21); // the target, 19 tables, the warning
    expect(t.lines.out).toMatch(/^user +OFF$/m);
    expect(t.lines.out).toMatch(/^exercise +on$/m);
    expect(t.lines.out).toContain("WARNING: 2 tables have row-level security OFF");
  });

  it("status with every table on prints no warning", async () => {
    const t = io();
    const client = { ...fakeCatalog([]), $disconnect: () => Promise.resolve() } as unknown as PrismaClient;
    expect(await main(["status"], { OWNER_DATABASE_URL: OWNER }, { io: t.io, makePrisma: () => client })).toBe(0);
    expect(t.lines.out).not.toContain("WARNING");
  });
});

describe("Spec 21.1 AC39 — every run says which database it acted on", () => {
  const run = async (argv: string[], url: string) => {
    const t = io();
    const client = { ...fakeCatalog([]), $disconnect: () => Promise.resolve() } as unknown as PrismaClient;
    expect(await main(argv, { OWNER_DATABASE_URL: url }, { io: t.io, makePrisma: () => client })).toBe(0);
    return t.lines.out.split("\n")[0];
  };

  it("names the database and login, and says the host is local, without printing it", async () => {
    expect(await run(["status"], OWNER)).toBe("target: database neondb, login neondb_owner, local host");
  });

  it("a remote host shows its first label, which tells staging from production when both use Neon's default names; the rest of the host and the password stay out", async () => {
    const line = await run(["status"], "postgresql://o:hunter2-secret@ep-cool-name.us-west-2.aws.neon.tech/neondb?sslmode=require");
    expect(line).toBe("target: database neondb, login neondb_owner, remote host ep-cool-name");
    expect(line).not.toContain("neon.tech");
    expect(line).not.toContain("us-west-2");
    expect(line).not.toContain("hunter2-secret");
  });

  it("two Neon projects with the same default names print different lines", async () => {
    const staging = await run(["status"], "postgresql://o:p@ep-staging-1.us-east-2.aws.neon.tech/neondb?sslmode=require");
    const production = await run(["status"], "postgresql://o:p@ep-prod-2.us-east-2.aws.neon.tech/neondb?sslmode=require");
    expect(staging).not.toBe(production);
  });

  it("the kill switch never guesses its target: no .env.owner fallback, so an unset URL is a refusal, not a run on the local database", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as { scripts: Record<string, string> };
    expect(pkg.scripts["db:rls"]).toBe("tsx scripts/db-rls.ts");
  });
});

describe("Spec 21.1 Review Focus 4 — the boot warning", () => {
  const logger = () => {
    const warnings: { data: unknown; msg: string }[] = [];
    return { warnings, log: { warn: (data: unknown, msg: string) => void warnings.push({ data, msg }) } };
  };

  it("names the tables that are off, at warn level", async () => {
    const l = logger();
    await warnIfRlsDisabled(fakeCatalog(["routine", "set_entry"]), l.log);
    expect(l.warnings).toEqual([{ data: { tables: ["routine", "set_entry"] }, msg: "rls_disabled" }]);
  });

  it("says nothing when every table is on", async () => {
    const l = logger();
    await warnIfRlsDisabled(fakeCatalog([]), l.log);
    expect(l.warnings).toEqual([]);
  });

  it("a read that never answers cannot hold up the boot: it gives up with the same warning", async () => {
    const l = logger();
    const stalled = { $queryRaw: () => new Promise(() => undefined) } as unknown as RlsCatalogClient;
    await warnIfRlsDisabled(stalled, l.log, 20);
    expect(l.warnings).toEqual([{ data: {}, msg: "rls_status_unavailable" }]);
  });

  it("a failed read never stops the boot: the kill switch must leave the API able to start (D5)", async () => {
    const l = logger();
    await warnIfRlsDisabled({ $queryRaw: () => Promise.reject(new Error("connection reset at db.example.com")) } as unknown as RlsCatalogClient, l.log);
    expect(l.warnings).toEqual([{ data: {}, msg: "rls_status_unavailable" }]);
  });
});
