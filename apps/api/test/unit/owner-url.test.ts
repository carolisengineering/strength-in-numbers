// apps/api/test/unit/owner-url.test.ts
import { describe, expect, it } from "vitest";
import { main as appRoleMain } from "../../src/db/app-role-cli.js";
import { main as purgeMain } from "../../src/account/purge-cli.js";
import { main as recordsMain } from "../../src/records/cli.js";
import { main as seedMain } from "../../src/seed/cli.js";
import { ownerDatabaseUrl, OWNER_URL_MISSING } from "../../src/db/owner-url.js";

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
