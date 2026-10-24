import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyMigrateStatus } from "../../scripts/lib/migrate-status.js";

const DIR = join(dirname(fileURLToPath(import.meta.url)), "../fixtures/migrate-status");
/** A captured `prisma migrate status` run: first line `exit=<n>`, then stdout + stderr. */
function fixture(name: string): [string, number] {
  const [first, ...rest] = readFileSync(join(DIR, `${name}.txt`), "utf8").split("\n");
  return [rest.join("\n"), Number(first!.replace("exit=", ""))];
}

describe("15 AC15 — classifyMigrateStatus over captured Prisma output", () => {
  it("up to date → ok", () => expect(classifyMigrateStatus(...fixture("up-to-date"))).toEqual({ ok: true, state: "up-to-date" }));
  it("a database that is only ahead (a rollback) → ok: Prisma reports it as up to date", () =>
    expect(classifyMigrateStatus(...fixture("db-ahead"))).toMatchObject({ ok: true }));
  it("pending → refused", () => expect(classifyMigrateStatus(...fixture("pending"))).toEqual({ ok: false, state: "pending" }));
  it("failed → refused", () => expect(classifyMigrateStatus(...fixture("failed"))).toEqual({ ok: false, state: "failed" }));
  it("ahead and pending → pending", () => expect(classifyMigrateStatus(...fixture("ahead-and-pending"))).toEqual({ ok: false, state: "pending" }));
  it("unreachable → refused", () => expect(classifyMigrateStatus(...fixture("unreachable"))).toEqual({ ok: false, state: "unreachable" }));
  it("the up-to-date phrase with a non-zero exit is not ok", () =>
    expect(classifyMigrateStatus("Database schema is up to date!", 1)).toEqual({ ok: false, state: "unknown" }));
  it("anything unrecognized → unknown, refused", () => expect(classifyMigrateStatus("something new", 0)).toEqual({ ok: false, state: "unknown" }));
  it("the captured fixtures carry no database URL or local path", () => {
    for (const name of ["up-to-date", "db-ahead", "pending", "failed", "ahead-and-pending", "unreachable"]) {
      expect(fixture(name)[0]).not.toMatch(/postgresql:\/\/|\/Users\//);
    }
  });
});

describe("15 AC15 / §7 — the database URL never reaches the log", () => {
  const URL_ = "postgresql://owner:s3cr3t-pw@ep-cool-name-123.us-east-2.aws.neon.tech:5432/neondb?sslmode=require&sslaccept=strict";
  it("removes the URL, its host, its hostname and its password", async () => {
    const { scrubDatabaseUrl } = await import("../../scripts/lib/migrate-status.js");
    const text = `at "${URL_}"\nError: P1001: Can't reach database server at \`ep-cool-name-123.us-east-2.aws.neon.tech:5432\`\nauth s3cr3t-pw failed for ep-cool-name-123.us-east-2.aws.neon.tech`;
    const out = scrubDatabaseUrl(text, URL_);
    expect(out).not.toMatch(/s3cr3t-pw|ep-cool-name-123|neondb\?sslmode/);
    expect(out).toContain("P1001");
  });
  it("a value that is not a URL is still removed verbatim", async () => {
    const { scrubDatabaseUrl } = await import("../../scripts/lib/migrate-status.js");
    expect(scrubDatabaseUrl("x not-a-url y", "not-a-url")).toBe("x <redacted> y");
  });
});
