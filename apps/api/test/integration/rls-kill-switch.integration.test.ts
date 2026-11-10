// apps/api/test/integration/rls-kill-switch.integration.test.ts
// Spec 21.1 AC39, Review Focus 4 — `db:rls` switches row-level security off and on, and the API keeps working either way.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../../src/app.js";
import { checkDatabaseReady } from "../../src/db.js";
import { assertLoginCannotBypassRls } from "../../src/db/login-check.js";
import { main } from "../../src/db/rls-cli.js";
import { RLS_LOCK_ORDER, RLS_TABLES, quoteIdent } from "../../src/db/rls-tables.js";
import { GENEROUS_LIMITS, TEST_ENV, testConfig } from "../helpers/build-test-app.js";
import { authContext, fakeVerifier } from "../helpers/fakes.js";
import { appRepositories, insertExercise, insertUser, shouldRunIntegration, startIntegrationDb, type AppIntegrationDb } from "./helpers.js";
import { logWorkout } from "./records-helpers.js";

const noTls = (url: string) => `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`;
const API_DIR = fileURLToPath(new URL("../../", import.meta.url));

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (a === null || typeof a === "string") return reject(new Error("no port"));
      s.close(() => resolve(a.port));
    });
  });
}

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC39 — the kill switch (real Postgres)", () => {
  let db: AppIntegrationDb;

  const run = async (argv: string[], url = noTls(db.url)) => {
    let out = "";
    let err = "";
    const code = await main(argv, { OWNER_DATABASE_URL: url }, { io: { out: (s) => void (out += s), err: (s) => void (err += s) } });
    return { code, out, err };
  };

  const enabledCount = async () =>
    Number(
      (
        await db.prisma.$queryRaw<{ n: bigint }[]>`
          SELECT count(*) AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relrowsecurity AND c.relname = ANY(${[...RLS_TABLES]}::text[])`
      )[0]!.n,
    );

  /** Boots the real entry point on `sin_app`, waits for it to listen, and returns its log lines. */
  async function bootLines(): Promise<Record<string, unknown>[]> {
    const port = await freePort();
    const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
      cwd: API_DIR,
      env: { PATH: process.env.PATH ?? "", ...TEST_ENV, DATABASE_URL: noTls(db.appUrl), PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let out = "";
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.stderr.on("data", (d: Buffer) => (out += d.toString()));
    const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()));
    try {
      const deadline = Date.now() + 30_000;
      while (!out.includes("api listening")) {
        if (Date.now() > deadline) throw new Error(`the API did not reach "api listening":\n${out}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      return out.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l) as Record<string, unknown>);
    } finally {
      child.kill("SIGTERM");
      await exited;
    }
  }

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterEach(async () => {
    // Every test leaves RLS on, even a failed one.
    await run(["enable"]);
  });

  afterAll(async () => {
    await db?.stop();
  });

  it("AC39 — disable, the API serves normally and the boot check passes; enable restores all 19", async () => {
    const sub = "auth0|kill-switch";
    const a = await insertUser(db);
    await db.prisma.$executeRawUnsafe(`UPDATE "user" SET auth_sub = $2 WHERE id = $1::uuid`, a, sub);
    const exercise = await insertExercise(db, { ownerUserId: a });
    const { workoutId } = await logWorkout(db, a, { startedAt: new Date(Date.now() - 86_400_000), exercises: [{ exerciseId: exercise, sets: [{ reps: 5, weight: 100 }] }] });

    const off = await run(["disable"]);
    expect(off.code, off.err).toBe(0);
    expect(off.out).toContain("row-level security is being switched OFF for all 19 tables; switch it back with db:rls -- enable");
    expect(off.out).toContain("WARNING: 19 tables have row-level security OFF");
    expect(await enabledCount()).toBe(0);

    const app = await buildApp({
      config: testConfig(),
      logger: false,
      checkReadiness: () => checkDatabaseReady(db.app),
      tokenVerifier: fakeVerifier(() => authContext({ authSub: sub, email: "u@ex.com" })),
      ...appRepositories(db.app),
      rateLimits: GENEROUS_LIMITS,
    });
    try {
      const res = await app.inject({ method: "GET", url: "/v1/workouts", headers: { authorization: "Bearer x" } });
      expect(res.statusCode, res.body).toBe(200);
      expect(res.json().items.map((w: { id: string }) => w.id)).toEqual([workoutId]);
    } finally {
      await app.close();
    }
    await expect(assertLoginCannotBypassRls(db.app)).resolves.toBeDefined();

    const on = await run(["enable"]);
    expect(on.code, on.err).toBe(0);
    expect(on.out).not.toContain("WARNING");
    expect(await enabledCount()).toBe(19);
  });

  it("AC39 — status prints one line per table and changes nothing", async () => {
    const { code, out } = await run(["status"]);
    expect(code).toBe(0);
    expect(out.trimEnd().split("\n")).toHaveLength(20);
    expect(out.split("\n")[0]).toMatch(/^target: database sin_test, login \w+, (local host|remote host \S+)$/);
    for (const table of RLS_TABLES) expect(out).toMatch(new RegExp(`^${table} +on$`, "m"));
    expect(await enabledCount()).toBe(19);
  });

  it("AC39 — enable and disable are safe to repeat", async () => {
    expect((await run(["disable"])).code).toBe(0);
    expect((await run(["disable"])).code).toBe(0);
    expect(await enabledCount()).toBe(0);
    expect((await run(["enable"])).code).toBe(0);
    expect((await run(["enable"])).code).toBe(0);
    expect(await enabledCount()).toBe(19);
  });

  it("AC39 — disable as the wrong login (sin_app) exits 1 and leaves RLS on", async () => {
    const { code, err } = await run(["disable"], noTls(db.appUrl));
    expect(code).toBe(1);
    expect(err).toContain("db:rls failed");
    expect(err).not.toContain("sin_app_test");
    expect(await enabledCount()).toBe(19);
  });

  it("AC39 — a disable that cannot finish changes nothing: one transaction", async () => {
    // A lock held on the last table in the order makes the switch fail partway; the tables before it must stay on.
    let release = () => {};
    const released = new Promise<void>((resolve) => (release = resolve));
    let markHeld = () => {};
    const held = new Promise<void>((resolve) => (markHeld = resolve));
    const holder = db.prisma.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`LOCK TABLE "equipment" IN ACCESS SHARE MODE`);
        markHeld();
        await released;
      },
      { timeout: 30_000 },
    );
    await held;
    try {
      const { code } = await run(["disable"]);
      expect(code).toBe(1);
      expect(await enabledCount()).toBe(19);
    } finally {
      release();
      await holder;
    }
  }, 30_000);

  it("AC39 — locks that each arrive inside their 5 s timeout still can't hold the switch past its limit", async () => {
    // Each table frees 4 s after the one before, so no single lock times out and only a limit on the whole statement can fire.
    const tables = RLS_LOCK_ORDER.slice(0, 4);
    const releases: (() => void)[] = [];
    const holders: Promise<void>[] = [];
    for (const table of tables) {
      let markHeld = () => {};
      const held = new Promise<void>((resolve) => (markHeld = resolve));
      holders.push(
        db.prisma.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`LOCK TABLE ${quoteIdent(table)} IN ACCESS SHARE MODE`);
            markHeld();
            await new Promise<void>((release) => releases.push(release));
          },
          { timeout: 40_000 },
        ),
      );
      await held;
    }
    const timers = releases.map((release, i) => setTimeout(release, 4_000 * (i + 1)));
    const started = Date.now();
    try {
      const { code } = await run(["disable"]);
      expect(code).toBe(1);
      expect(Date.now() - started).toBeLessThan(14_000);
      expect(await enabledCount()).toBe(19);
    } finally {
      for (const timer of timers) clearTimeout(timer);
      for (const release of releases) release();
      await Promise.all(holders);
    }
  }, 45_000);

  describe("Review Focus 4 — the boot warning", () => {
    it("with RLS off, the server logs rls_disabled naming 19 tables and still reaches api listening", async () => {
      expect((await run(["disable"])).code).toBe(0);
      const lines = await bootLines();
      const warning = lines.find((l) => l.msg === "rls_disabled");
      expect(warning).toMatchObject({ level: 40 });
      expect([...(warning!.tables as string[])].sort()).toEqual([...RLS_TABLES].sort());
    }, 45_000);

    it("with RLS on, there is no rls_disabled line", async () => {
      const lines = await bootLines();
      expect(lines.some((l) => l.msg === "api listening")).toBe(true);
      expect(lines.some((l) => l.msg === "rls_disabled")).toBe(false);
    }, 45_000);
  });
});
