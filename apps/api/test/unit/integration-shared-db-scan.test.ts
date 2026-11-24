import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Issue 361 — integration files share one Postgres, each with a database of its own (`startIntegrationDb`). A database
 * is private; the server is not. A file that reads or changes something the whole server shares must take a container
 * of its own (`startPrivateIntegrationDb`), or another file running beside it changes what it sees.
 */
const dir = fileURLToPath(new URL("../integration/", import.meta.url));

/** What the whole server shares, and why a file that names it can't sit on the shared one. */
const SERVER_WIDE: [RegExp, string][] = [
  [/\b(?:CREATE|ALTER|DROP) ROLE\b/, "roles belong to the server, and other files read the role list"],
  [/\bREVOKE \w+ FROM\b|\bGRANT \w+ TO\b/, "role membership belongs to the server"],
  [/\bALTER SYSTEM\b|\bpg_reload_conf\b|\bpg_terminate_backend\b|\bpg_cancel_backend\b/, "server settings and other files' sessions"],
  [/\bpg_stat_activity\b|\bpg_locks\b/, "every database's sessions and locks are listed, so a wait for 'someone is blocked' can see another file's"],
  [/\bsin_test\b/, "a shared database has a random name"],
  [
    /[?&]since=|\bsyncToken\b|\bpg_snapshot_xm(?:in|ax)\b|\bpg_current_snapshot\b/,
    "the exercise sync token is the server's snapshot xmin, which another file's open transaction holds back",
  ],
];

/** The helpers' own test: it starts one of each on purpose, and names the private database to tell them apart. */
const BOTH_ON_PURPOSE = "shared-db.integration.test.ts";

function testFiles(sub = ""): string[] {
  return readdirSync(`${dir}${sub}`).flatMap((name) => {
    const rel = `${sub}${name}`;
    if (statSync(`${dir}${rel}`).isDirectory()) return testFiles(`${rel}/`);
    return rel.endsWith(".test.ts") ? [rel] : [];
  });
}

/** The reasons `text` can't use the shared server; empty when it may. */
export function sharedServerProblems(text: string): string[] {
  if (!/\bstartIntegrationDb\(/.test(text)) return [];
  return SERVER_WIDE.filter(([pattern]) => pattern.test(text)).map(([pattern, why]) => `${pattern.source}: ${why}`);
}

describe("issue 361 — a file that needs the whole server takes its own", () => {
  it.each([
    ["creating a role", "await db.prisma.$executeRawUnsafe(`CREATE ROLE t_owner LOGIN`);"],
    ["a role membership change", "await db.prisma.$executeRawUnsafe(`REVOKE pg_read_all_data FROM sin_app`);"],
    ["a wait on pg_stat_activity", "SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Lock'"],
    ["a wait on pg_locks", "SELECT count(*) FROM pg_locks WHERE NOT granted"],
    ["the database's name", "expect(out).toMatch(/^target: database sin_test,/);"],
    ["a since delta", "await inject('GET', `/v1/exercises?since=${token}`)"],
    ["a sync token", "const token = res.json().syncToken as string;"],
  ])("%s on the shared server is refused", (_name, line) => {
    expect(sharedServerProblems(`db = await startIntegrationDb();\n${line}\n`)).toHaveLength(1);
  });

  it.each([
    ["a table grant", 'await db.prisma.$executeRawUnsafe(`REVOKE DELETE ON "equipment" FROM sin_app`);'],
    ["a read of the role list", "SELECT rolname FROM pg_roles WHERE rolbypassrls OR rolsuper"],
    ["a plain query", 'SELECT id FROM "user"'],
  ])("%s on the shared server is allowed", (_name, line) => {
    expect(sharedServerProblems(`db = await startIntegrationDb();\n${line}\n`)).toEqual([]);
  });

  it("the same statements are fine in a file with its own container", () => {
    expect(sharedServerProblems("db = await startPrivateIntegrationDb();\nCREATE ROLE t_owner LOGIN\nSELECT 1 FROM pg_locks\n")).toEqual([]);
  });

  it("no integration file on the shared server names something the server shares", () => {
    const files = testFiles().filter((file) => file !== BOTH_ON_PURPOSE);
    expect(files.length).toBeGreaterThan(100);
    const offenders = files.flatMap((file) => sharedServerProblems(readFileSync(`${dir}${file}`, "utf8")).map((why) => `${file} — ${why}`));
    expect(offenders).toEqual([]);
  });
});
