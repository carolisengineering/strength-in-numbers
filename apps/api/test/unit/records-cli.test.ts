import { describe, expect, it } from "vitest";
import { main, parseRebuildArgs } from "../../src/records/cli.js";

const QUIET = { LOG_LEVEL: "silent" };
const ID = "018fcb3e-3b8a-7d6e-9c1a-000000000001";

describe("AC22 — records:rebuild argument parsing", () => {
  it("no arguments → every user", () => {
    expect(parseRebuildArgs([])).toEqual({ ok: true, userId: undefined });
  });

  it("accepts --user <id> and --user=<id>", () => {
    expect(parseRebuildArgs(["--user", ID])).toEqual({ ok: true, userId: ID });
    expect(parseRebuildArgs([`--user=${ID}`])).toEqual({ ok: true, userId: ID });
  });

  it("ignores a bare -- separator (pnpm run … -- --user <id>)", () => {
    expect(parseRebuildArgs(["--", "--user", ID])).toEqual({ ok: true, userId: ID });
  });

  it("rejects --user with no value or a malformed id", () => {
    expect(parseRebuildArgs(["--user"]).ok).toBe(false);
    expect(parseRebuildArgs(["--user", "not-a-uuid"]).ok).toBe(false);
    expect(parseRebuildArgs(["--user=not-a-uuid"]).ok).toBe(false);
  });

  it("rejects any unrecognised argument instead of rebuilding every user", () => {
    expect(parseRebuildArgs(["--users", ID]).ok).toBe(false);
    expect(parseRebuildArgs([ID]).ok).toBe(false);
    expect(parseRebuildArgs(["--user", ID, "--dry-run"]).ok).toBe(false);
    expect(parseRebuildArgs(["--user", ID, "--user", ID]).ok).toBe(false);
  });
});

describe("AC22 — records:rebuild CLI exits 1 before touching a database", () => {
  it("exits 1 without DATABASE_URL", async () => {
    await expect(main([], { ...QUIET })).resolves.toBe(1);
  });

  it("exits 1 on a bad argument", async () => {
    await expect(main(["--users", ID], { ...QUIET, DATABASE_URL: "postgresql://u:p@localhost:5432/sin" })).resolves.toBe(1);
  });

  it("exits 1 (no crash) when DATABASE_URL is rejected by resolveDatabaseUrl", async () => {
    const env = { ...QUIET, DATABASE_URL: "postgresql://u:p@localhost:5432/sin?sslmode=verify-full" };
    await expect(main([], env)).resolves.toBe(1);
  });
});
