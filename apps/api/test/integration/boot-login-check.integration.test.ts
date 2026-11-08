// apps/api/test/integration/boot-login-check.integration.test.ts
import { spawn } from "node:child_process";
import { connect, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEST_ENV } from "../helpers/build-test-app.js";
import { shouldRunIntegration, startIntegrationDb, startMigratedDb, TEST_APP_PASSWORD, type AppIntegrationDb, type IntegrationDb } from "./helpers.js";

/**
 * Spec 21.1 AC25, AC31 — the real entry point, spawned: on an unsafe login it exits 1 with the one-line reason and
 * never binds its port; on `sin_app` it logs `db_login_checked` and serves.
 */

const API_DIR = fileURLToPath(new URL("../../", import.meta.url));
const noTls = (url: string) => `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as { port: number };
      s.close(() => resolve(port));
    });
  });
}

function portRefuses(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const c = connect({ port, host: "127.0.0.1" });
    c.once("connect", () => {
      c.destroy();
      resolve(false);
    });
    c.once("error", () => resolve(true));
  });
}

interface Booted {
  child: ReturnType<typeof spawn>;
  stdout: () => string;
  stderr: () => string;
  exited: Promise<number | null>;
}

function boot(databaseUrl: string, port: number): Booted {
  const child = spawn(process.execPath, ["--import", "tsx", "src/main.ts"], {
    cwd: API_DIR,
    env: { PATH: process.env.PATH ?? "", ...TEST_ENV, DATABASE_URL: databaseUrl, PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  let err = "";
  child.stdout!.on("data", (d: Buffer) => (out += d.toString()));
  child.stderr!.on("data", (d: Buffer) => (err += d.toString()));
  const exited = new Promise<number | null>((resolve) => child.once("exit", (code) => resolve(code)));
  return { child, stdout: () => out, stderr: () => err, exited };
}

async function until(check: () => boolean, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 100));
  }
}

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC25 — the boot check runs before the server listens", () => {
  let db: AppIntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    db = await startIntegrationDb();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it("refuses an owner login before listening: exit 1 within 25 s, one line, no password or host, port never bound", async () => {
    // A superuser with a distinctive name and password (the container's user and password are both "test").
    await db.prisma.$executeRawUnsafe(`CREATE ROLE boot_owner SUPERUSER LOGIN PASSWORD 'boot-owner-secret'`);
    const u = new URL(db.url);
    u.username = "boot_owner";
    u.password = "boot-owner-secret";
    const port = await freePort();
    const b = boot(noTls(u.toString()), port);
    const code = await Promise.race([b.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 25_000))]);
    expect(code, b.stderr()).toBe(1);
    const lines = b.stderr().split("\n").filter((l) => l.trim() !== "");
    expect(lines, b.stderr()).toHaveLength(1);
    expect(lines[0]).toMatch(/^Refusing to start: the database login "boot_owner" can bypass row-level security \(superuser\)/);
    expect(b.stderr()).not.toContain("boot-owner-secret");
    expect(b.stderr()).not.toContain(u.host);
    expect(await portRefuses(port)).toBe(true);
    // The refusal is also a log line with the facts, before the error is rethrown.
    const logged = b.stdout().split("\n").filter((l) => l.includes("db_login_checked"));
    expect(logged).toHaveLength(1);
    expect(JSON.parse(logged[0]!)).toMatchObject({ level: 50, superuser: true });
  }, 40_000);

  it("boots on sin_app: a db_login_checked line, then listening, and /healthz answers", async () => {
    const port = await freePort();
    const b = boot(noTls(db.appUrl), port);
    try {
      await until(() => b.stdout().includes("api listening"), 30_000);
      const lines = b.stdout().split("\n").filter((l) => l.trim() !== "").map((l) => JSON.parse(l) as Record<string, unknown>);
      const checked = lines.findIndex((l) => l.msg === "db_login_checked");
      const listening = lines.findIndex((l) => l.msg === "api listening");
      expect(checked).toBeGreaterThanOrEqual(0);
      expect(checked).toBeLessThan(listening);
      expect(lines[checked]).toMatchObject({ level: 30, role: "sin_app", superuser: false, bypassrls: false });
      const res = await fetch(`http://127.0.0.1:${port}/healthz`);
      expect(res.status).toBe(200);
    } finally {
      b.child.kill("SIGTERM");
      await b.exited;
    }
  }, 45_000);
});

describe.skipIf(!shouldRunIntegration())("Spec 21.1 AC31 — a database without the sin_app login", () => {
  let fresh: IntegrationDb;

  beforeAll(async () => {
    if (!shouldRunIntegration()) return;
    fresh = await startMigratedDb();
  }, 180_000);

  afterAll(async () => {
    await fresh?.stop();
  });

  it("stops at the boot check with the db:app-role pointer", async () => {
    const u = new URL(fresh.url);
    u.username = "sin_app";
    u.password = TEST_APP_PASSWORD;
    const port = await freePort();
    const b = boot(noTls(u.toString()), port);
    const code = await Promise.race([b.exited, new Promise<"timeout">((r) => setTimeout(() => r("timeout"), 25_000))]);
    expect(code, b.stderr()).toBe(1);
    expect(b.stderr()).toContain("pnpm --filter @sin/api run db:app-role");
    expect(await portRefuses(port)).toBe(true);
  }, 40_000);
});
