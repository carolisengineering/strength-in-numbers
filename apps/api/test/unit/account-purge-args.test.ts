import { describe, expect, it, vi } from "vitest";
import { main, parsePurgeArgs } from "../../src/account/purge-cli.js";

const ID = "018fcb3e-3b8a-7d6e-9c1a-000000000001";
const ID2 = "018fcb3e-3b8a-7d6e-9c1a-000000000002";
const QUIET = { LOG_LEVEL: "silent" };
const URL_OK = "postgresql://u:p@localhost:5432/sin";

describe("AC28 — parsePurgeArgs", () => {
  it.each([
    [[], { confirm: false, skipGrace: false }],
    [["--confirm"], { confirm: true, skipGrace: false }],
    [["--user", ID], { confirm: false, skipGrace: false, userId: ID }],
    [[`--user=${ID}`, "--confirm"], { confirm: true, skipGrace: false, userId: ID }],
    [["--", "--user", ID, "--skip-grace", "--confirm"], { confirm: true, skipGrace: true, userId: ID }],
  ])("accepts %j", (argv, options) => {
    expect(parsePurgeArgs(argv)).toEqual({ ok: true, options });
  });

  it.each([
    [["--confrim"]],
    [["--confirm", "--confirm"]],
    [["--skip-grace"]],
    [["--skip-grace", "--confirm"]],
    [["--user"]],
    [["--user="]],
    [["--user", "not-a-uuid"]],
    [["--user", ID, "--user", ID2]],
    [["--user", ID, "--skip-grace", "--skip-grace"]],
    [[ID]],
  ])("rejects %j (Review Focus 3)", (argv) => {
    expect(parsePurgeArgs(argv).ok).toBe(false);
  });
});

describe("AC28 — main exits 1 before touching a database", () => {
  it("without DATABASE_URL", async () => {
    const makePrisma = vi.fn();
    await expect(main(["--confirm"], { ...QUIET }, { makePrisma })).resolves.toBe(1);
    expect(makePrisma).not.toHaveBeenCalled();
  });

  it("on a bad argument", async () => {
    const makePrisma = vi.fn();
    await expect(main(["--skip-grace"], { ...QUIET, DATABASE_URL: URL_OK }, { makePrisma })).resolves.toBe(1);
    expect(makePrisma).not.toHaveBeenCalled();
  });

  it("when resolveDatabaseUrl rejects the URL", async () => {
    const makePrisma = vi.fn();
    const env = { ...QUIET, DATABASE_URL: `${URL_OK}?sslmode=verify-full` };
    await expect(main([], env, { makePrisma })).resolves.toBe(1);
    expect(makePrisma).not.toHaveBeenCalled();
  });
});
