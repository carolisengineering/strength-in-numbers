// apps/api/test/unit/app-role-cli.test.ts
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { main } from "../../src/db/app-role-cli.js";
import { appRoleIsClean, setAppRoleLogin, type AppRoleReport } from "../../src/db/app-role.js";

/** Spec 21.1 AC29 — the CLI's refusals happen before any database call. */
function io(opts: { isTTY: boolean; answer?: string }) {
  const lines = { out: "", err: "", prompted: 0 };
  return {
    lines,
    io: {
      prompt: () => {
        lines.prompted += 1;
        return Promise.resolve(opts.answer ?? "");
      },
      out: (s: string) => void (lines.out += s),
      err: (s: string) => void (lines.err += s),
      isTTY: opts.isTTY,
    },
  };
}
const neverConnect = (): PrismaClient => {
  throw new Error("must not touch a database");
};
const OWNER = "postgresql://owner:owner-secret@127.0.0.1:5433/sin?sslmode=disable";

describe("Spec 21.1 AC29 — db:app-role refuses before touching a database", () => {
  it("no owner URL: exit 1, says which variable to set", async () => {
    const t = io({ isTTY: false });
    expect(await main([], { APP_ROLE_PASSWORD: "long-enough-password" }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.err).toContain("OWNER_DATABASE_URL");
  });

  it("no TTY and no APP_ROLE_PASSWORD: exit 1, no prompt", async () => {
    const t = io({ isTTY: false });
    expect(await main([], { OWNER_DATABASE_URL: OWNER }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.prompted).toBe(0);
    expect(t.lines.err).toContain("APP_ROLE_PASSWORD");
  });

  it("an 11-character password: exit 1 (the floor is 12), and it is not echoed", async () => {
    const t = io({ isTTY: false });
    expect(await main([], { OWNER_DATABASE_URL: OWNER, APP_ROLE_PASSWORD: "elevenchars" }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.err).toContain("12");
    expect(t.lines.out + t.lines.err).not.toContain("elevenchars");
  });

  it("an empty APP_ROLE_PASSWORD on a TTY prompts instead (and a short answer is refused)", async () => {
    const t = io({ isTTY: true, answer: "short" });
    expect(await main([], { OWNER_DATABASE_URL: OWNER, APP_ROLE_PASSWORD: "" }, { io: t.io, makePrisma: neverConnect })).toBe(1);
    expect(t.lines.prompted).toBe(1);
  });

  it("an argument is refused (the command takes none)", async () => {
    const t = io({ isTTY: false });
    expect(await main(["--force"], { OWNER_DATABASE_URL: OWNER, APP_ROLE_PASSWORD: "long-enough-password" }, { io: t.io, makePrisma: neverConnect })).toBe(1);
  });
});

describe("Spec 21.1 Review Focus 3 — a failure's text never carries the owner URL (/code-review)", () => {
  it("the whole URL goes, not just its password: no user, no host, no encoded password", async () => {
    const url = "postgresql://owner:owner%2Fsecret@ep-x.neon.tech:5432/sin?sslmode=require&sslaccept=strict";
    const failing = {
      $transaction: () => Promise.reject(new Error(`connect failed for ${url} at ep-x.neon.tech:5432 with owner/secret and owner%2Fsecret`)),
      $disconnect: () => Promise.resolve(),
    } as unknown as PrismaClient;
    const t = io({ isTTY: false });
    expect(await main([], { OWNER_DATABASE_URL: url, APP_ROLE_PASSWORD: "long-enough-password" }, { io: t.io, makePrisma: () => failing })).toBe(1);
    expect(t.lines.err).toContain("db:app-role failed");
    expect(t.lines.err).not.toMatch(/owner%2Fsecret|owner\/secret|ep-x\.neon|postgresql:/);
  });
});

describe("Spec 21.1 AC29 — the report and the missing role", () => {
  const clean: AppRoleReport = { rolname: "sin_app", canLogin: true, superuser: false, bypassrls: false, createRole: false, createDb: false, memberOf: [] };

  it("appRoleIsClean: login on, the other four flags off, no membership", () => {
    expect(appRoleIsClean(clean)).toBe(true);
    expect(appRoleIsClean({ ...clean, canLogin: false })).toBe(false);
    for (const flag of ["superuser", "bypassrls", "createRole", "createDb"] as const) expect(appRoleIsClean({ ...clean, [flag]: true })).toBe(false);
    expect(appRoleIsClean({ ...clean, memberOf: ["pg_read_all_data"] })).toBe(false);
  });

  it("a missing role: says to run db:migrate:deploy first", async () => {
    const tx = {
      $queryRaw: () => Promise.resolve([]),
      $executeRaw: () => Promise.resolve(0),
    };
    const owner = { $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx) } as unknown as PrismaClient;
    await expect(setAppRoleLogin(owner, "long-enough-password")).rejects.toThrow(
      "sin_app does not exist: run db:migrate:deploy first (migration 0020 creates it)",
    );
  });
});
