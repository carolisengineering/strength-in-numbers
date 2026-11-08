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
    const input = { OWNER_DATABASE_URL: "postgresql://owner", DATABASE_URL: "postgresql://app", OTHER: "x" };
    const r = resolveOwnerEnv(input);
    expect(r).toEqual({ ok: true, env: { OWNER_DATABASE_URL: "postgresql://owner", DATABASE_URL: "postgresql://owner", OTHER: "x" } });
    expect(input.DATABASE_URL).toBe("postgresql://app");
  });

  it("a lone DATABASE_URL, and Review Focus 5's empty owner URL, are refused", async () => {
    const { resolveOwnerEnv } = await load();
    expect(resolveOwnerEnv({ DATABASE_URL: "postgresql://app" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
    expect(resolveOwnerEnv({ DATABASE_URL: "postgresql://app", OWNER_DATABASE_URL: "" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
  });

  it("invoked directly: the child sees the owner URL as DATABASE_URL", () => {
    const r = run({ OWNER_DATABASE_URL: "postgresql://owner", DATABASE_URL: "postgresql://app" }, "process.stdout.write(process.env.DATABASE_URL)");
    expect(r.status).toBe(0);
    expect(r.stdout).toBe("postgresql://owner");
  });

  it("invoked directly: exits with the child's status", () => {
    expect(run({ OWNER_DATABASE_URL: "postgresql://owner" }, "process.exit(7)").status).toBe(7);
  });

  it("invoked directly with no owner URL: exit 1 with the message, and the command never runs", () => {
    const r = run({ DATABASE_URL: "postgresql://app" }, "process.stdout.write('ran')");
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(OWNER_URL_MISSING);
    expect(r.stdout).not.toContain("ran");
  });
});
