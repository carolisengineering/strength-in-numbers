// apps/api/test/unit/owner-url.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { main as appRoleMain } from "../../src/db/app-role-cli.js";
import { main as purgeMain } from "../../src/account/purge-cli.js";
import { main as recordsMain } from "../../src/records/cli.js";
import { main as seedMain } from "../../src/seed/cli.js";
import { isLocalHost, ownerDatabaseUrl, OWNER_URL_MISSING, resolveOwnerUrl } from "../../src/db/owner-url.js";

/**
 * Spec 21.1 AC28 — maintenance commands use only `OWNER_DATABASE_URL`. After the switch `DATABASE_URL` is the restricted
 * login, so a command that fell back to it would run as a login that cannot migrate, or (before the switch) quietly use
 * whichever URL happens to be set.
 */
describe("Spec 21.1 AC28 — ownerDatabaseUrl", () => {
  it("returns the owner URL", () => {
    expect(ownerDatabaseUrl({ OWNER_DATABASE_URL: "postgresql://o:p@h/d" })).toEqual({ ok: true, url: "postgresql://o:p@h/d" });
  });

  it("a lone DATABASE_URL is refused with the message that says which variable to set", () => {
    expect(ownerDatabaseUrl({ DATABASE_URL: "postgresql://x" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
    expect(OWNER_URL_MISSING).toBe("set OWNER_DATABASE_URL to the owner login; DATABASE_URL is the application login and cannot migrate");
  });

  it("Review Focus 5 — an empty value counts as missing", () => {
    expect(ownerDatabaseUrl({ OWNER_DATABASE_URL: "" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
  });

  it("the owner URL wins when both are set; DATABASE_URL is never read", () => {
    expect(ownerDatabaseUrl({ OWNER_DATABASE_URL: "postgresql://owner", DATABASE_URL: "postgresql://app" })).toEqual({ ok: true, url: "postgresql://owner" });
  });
});

describe("Spec 21.1 Review Focus 3 — a malformed owner URL never reaches the output (final review I1)", () => {
  // An unencoded "/" in the password: new URL() throws, and its error carries the whole string in `input`.
  const MALFORMED = { LOG_LEVEL: "info", OWNER_DATABASE_URL: "postgresql://neondb_owner:s3cr3t/pw@ep-example.neon.tech/neondb" };
  async function printed(run: () => Promise<number>): Promise<{ code: number; out: string }> {
    const out: string[] = [];
    const write = vi.spyOn(process.stdout, "write").mockImplementation((s) => {
      out.push(String(s));
      return true;
    });
    try {
      return { code: await run(), out: out.join("") };
    } finally {
      write.mockRestore();
    }
  }
  for (const [name, run] of [
    ["records:rebuild", () => recordsMain([], MALFORMED)],
    ["seed:catalog", () => seedMain([], MALFORMED)],
  ] as const) {
    it(`${name}: exit 1, says the URL was rejected, prints no part of it`, async () => {
      const { code, out } = await printed(run);
      expect(code).toBe(1);
      expect(out).toContain("OWNER_DATABASE_URL rejected");
      expect(out).not.toMatch(/s3cr3t|neondb_owner|ep-example/);
    });
  }
});

describe("Spec 21.1 final review I3 — the local env file cannot set a password on another database", () => {
  it(".env.owner.example carries no APP_ROLE_PASSWORD: with a Neon OWNER_DATABASE_URL exported, db:app-role must ask", () => {
    const example = readFileSync(new URL("../../.env.owner.example", import.meta.url), "utf8");
    expect(example).not.toMatch(/^\s*APP_ROLE_PASSWORD=/m);
  });
});

describe("Spec 21.1 AC28 — each maintenance CLI refuses a lone DATABASE_URL, without connecting", () => {
  const LONE = { LOG_LEVEL: "silent", DATABASE_URL: "postgresql://u:p@127.0.0.1:1/x", APP_ROLE_PASSWORD: "long-enough-password" };
  const makePrisma = () => {
    throw new Error("must not connect");
  };
  it("records:rebuild", async () => {
    expect(await recordsMain([], LONE)).toBe(1);
  });
  it("account:purge", async () => {
    expect(await purgeMain([], LONE, { makePrisma })).toBe(1);
  });
  it("seed:catalog", async () => {
    expect(await seedMain([], LONE)).toBe(1);
  });
  it("db:app-role", async () => {
    const io = { prompt: () => Promise.resolve(""), out: () => undefined, err: () => undefined, isTTY: false };
    expect(await appRoleMain([], LONE, { io, makePrisma })).toBe(1);
  });
});

describe("minor 416 — resolveOwnerUrl", () => {
  it("missing or empty: the one message", () => {
    expect(resolveOwnerUrl({})).toEqual({ ok: false, error: OWNER_URL_MISSING });
    expect(resolveOwnerUrl({ OWNER_DATABASE_URL: "" })).toEqual({ ok: false, error: OWNER_URL_MISSING });
  });

  it("a malformed URL is rejected, and nothing in the result holds its password or host", () => {
    const r = resolveOwnerUrl({ OWNER_DATABASE_URL: "postgresql://neondb_owner:s3cr3t/pw@ep-example.neon.tech/neondb" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toBe("OWNER_DATABASE_URL rejected");
    expect(r.fields?.error_class).toBe("TypeError");
    expect(JSON.stringify(r)).not.toMatch(/s3cr3t|neondb_owner|ep-example/);
  });

  it("a good URL: resolved (TLS backfilled), with its hostname and the secrets a message must never show", () => {
    const r = resolveOwnerUrl({ OWNER_DATABASE_URL: "postgresql://o:p%40ss@ep-x.neon.tech/sin" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.url).toContain("sslmode=require");
    expect(r.url).toContain("sslaccept=strict");
    expect(r.hostname).toBe("ep-x.neon.tech");
    expect(r.secrets).toEqual(expect.arrayContaining(["postgresql://o:p%40ss@ep-x.neon.tech/sin", r.url, "p%40ss", "p@ss", "ep-x.neon.tech"]));
  });
});

describe("minor 441 — one list of local hosts", () => {
  it("Review Focus 2: localhost, 127.0.0.1, [::1] and the compose service db are local; a bare ::1 and a Neon host are not", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "db"]) expect(isLocalHost(host), host).toBe(true);
    for (const host of ["::1", "ep-x.neon.tech"]) expect(isLocalHost(host), host).toBe(false);
    expect(new URL("postgresql://o:p@[::1]:5433/sin").hostname).toBe("[::1]");
  });

  it("owner-url.ts and database-url.ts import nothing from Prisma (deploy-prod runs with no generated client)", () => {
    for (const file of ["../../src/db/owner-url.ts", "../../src/db/database-url.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source, file).not.toMatch(/from "@prisma\/client"|from "\.\.\/db\.js"/);
    }
  });
});
