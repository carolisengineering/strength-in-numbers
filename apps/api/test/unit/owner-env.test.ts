// apps/api/test/unit/owner-env.test.ts
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OWNER_URL_MISSING } from "../../src/db/owner-url.js";

/**
 * Spec 21.1 AC28, §6.8 — `scripts/owner-env.mjs` runs the repo-pinned Prisma with `DATABASE_URL` set from
 * `OWNER_DATABASE_URL`, for the child process only. It is plain `.mjs` (it runs before anything is compiled), so its copy
 * of the message is pinned to the library's here.
 */
const SCRIPT = fileURLToPath(new URL("../../scripts/owner-env.mjs", import.meta.url));

interface OwnerEnvModule {
  OWNER_URL_MISSING: string;
  resolveOwnerEnv(env: Record<string, string | undefined>): { ok: true; env: Record<string, string | undefined> } | { ok: false; error: string };
}
const load = async () => (await import(SCRIPT)) as OwnerEnvModule;
const OWNER = "postgresql://o:secret-pw@ep-x.neon.tech/neondb?sslmode=require&sslaccept=strict";

/** `node scripts/owner-env.mjs node -e <code>` with exactly this environment, so the child is a small probe. */
function run(env: Record<string, string>, code: string) {
  return spawnSync(process.execPath, [SCRIPT, process.execPath, "-e", code], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });
}

describe("Spec 21.1 AC28 — owner-env", () => {
  it("its message is the library's, exactly", async () => {
    expect((await load()).OWNER_URL_MISSING).toBe(OWNER_URL_MISSING);
  });

  it("resolveOwnerEnv maps the owner URL to DATABASE_URL and does not change the real environment", async () => {
    const { resolveOwnerEnv } = await load();
    const input = { OWNER_DATABASE_URL: OWNER, DATABASE_URL: "postgresql://app", OTHER: "x" };
    const r = resolveOwnerEnv(input);
    expect(r).toEqual({ ok: true, env: { OWNER_DATABASE_URL: OWNER, DATABASE_URL: OWNER, OTHER: "x" } });
    expect(input.DATABASE_URL).toBe("postgresql://app");
  });

  it("a lone DATABASE_URL, and Review Focus 5's empty owner URL, are refused", async () => {
    const { resolveOwnerEnv } = await load();
    expect(resolveOwnerEnv({ DATABASE_URL: "postgresql://app" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
    expect(resolveOwnerEnv({ DATABASE_URL: "postgresql://app", OWNER_DATABASE_URL: "" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
  });

  it("invoked directly: the child sees the owner URL as DATABASE_URL", () => {
    const r = run({ OWNER_DATABASE_URL: OWNER, DATABASE_URL: "postgresql://app" }, "process.stdout.write(process.env.DATABASE_URL)");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe(OWNER);
  });

  it("invoked directly: exits with the child's status", () => {
    expect(run({ OWNER_DATABASE_URL: OWNER }, "process.exit(7)").status).toBe(7);
  });

  describe("final review I4 — prisma migrate reads the raw URL, so it must carry its own certificate check (#8)", () => {
    it("a Neon string with no sslaccept=strict is refused, and the URL is not printed", () => {
      const r = run({ OWNER_DATABASE_URL: "postgresql://o:secret-pw@ep-x.neon.tech/neondb?sslmode=require" }, "process.stdout.write('ran')");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("sslaccept=strict");
      expect(r.stderr).not.toMatch(/secret-pw|ep-x\.neon/);
      expect(r.stdout).not.toContain("ran");
    });
    it("the local database's sslmode=disable is an explicit choice, and passes", () => {
      for (const host of ["localhost:5433", "127.0.0.1:5433", "db:5432"]) {
        expect([host, run({ OWNER_DATABASE_URL: `postgresql://sin:sin@${host}/sin?sslmode=disable` }, "process.exit(0)").status]).toEqual([host, 0]);
      }
    });
    // /code-review: Prisma treats anything but require / disable as "TLS optional", whatever sslaccept says (db.ts).
    for (const query of ["sslaccept=strict", "sslmode=prefer&sslaccept=strict", "sslmode=verify-full&sslaccept=strict", "sslmode=require&sslaccept=accept_invalid_certs"]) {
      it(`refused: ?${query}`, () => {
        const r = run({ OWNER_DATABASE_URL: `postgresql://o:secret-pw@ep-x.neon.tech/neondb?${query}` }, "process.stdout.write('ran')");
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("sslaccept=strict");
        expect(r.stdout).not.toContain("ran");
      });
    }
    it("sslmode=disable on a remote host is refused", () => {
      const r = run({ OWNER_DATABASE_URL: "postgresql://o:secret-pw@ep-x.neon.tech/neondb?sslmode=disable" }, "process.stdout.write('ran')");
      expect(r.status).toBe(1);
      expect(r.stdout).not.toContain("ran");
    });
    it("check-migrate-status goes through the same guard: the deploy job cannot use an unverified owner URL (/code-review)", () => {
      const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/check-migrate-status.ts"], {
        cwd: fileURLToPath(new URL("../..", import.meta.url)),
        encoding: "utf8",
        env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", OWNER_DATABASE_URL: "postgresql://o:secret-pw@ep-x.neon.tech/neondb?sslmode=require" },
      });
      expect(r.status).toBe(1);
      expect(r.stdout + r.stderr).toContain("sslaccept=strict");
      expect(r.stdout + r.stderr).not.toMatch(/secret-pw|ep-x\.neon/);
    }, 60_000);
    it("a malformed URL is refused without printing it", () => {
      const r = run({ OWNER_DATABASE_URL: "postgresql://o:secret/pw@ep-x.neon.tech/neondb" }, "process.stdout.write('ran')");
      expect(r.status).toBe(1);
      expect(r.stderr).not.toMatch(/secret|ep-x\.neon/);
    });
  });

  it("invoked directly with no owner URL: exit 1 with the message, and the command never runs", () => {
    const r = run({ DATABASE_URL: "postgresql://app" }, "process.stdout.write('ran')");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(OWNER_URL_MISSING);
    expect(r.stdout).not.toContain("ran");
  });
});
