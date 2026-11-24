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
  [/\b(?:CREATE|ALTER|DROP) (?:ROLE|USER)\b/i, "roles belong to the server, and other files read the role list"],
  [/\bsetAppRoleLogin\(|app-role-cli/, "sin_app's login belongs to the server: a new password locks every other file out"],
  // A membership grant names roles only; a table grant has ` ON ` and stays inside its database.
  [/\bREVOKE (?:(?! ON )[\w", ])+ FROM\b|\bGRANT (?:(?! ON )[\w", ])+ TO\b/i, "role membership belongs to the server"],
  [/\bALTER (?:SYSTEM|DATABASE)\b|\bCREATE TABLESPACE\b|\bpg_reload_conf\b|\bpg_terminate_backend\b|\bpg_cancel_backend\b/i, "server settings and other files' sessions"],
  [/\bpg_stat_\w+|\bpg_locks\b/i, "every database's sessions and locks are listed, so a wait for 'someone is blocked' can see another file's"],
  [/\bsin_test\b|\bpg_database\b/i, "a shared database has a random name, and other files' databases come and go beside it"],
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

/** The database helpers themselves: they name what they manage, and every file imports them. */
const DB_HELPERS = new Set(["helpers.ts", "global-setup.ts"]);

/** A test file's text plus the helper modules in `test/integration` it imports directly, where its SQL may live. */
function textWithHelpers(file: string): string {
  const own = readFileSync(`${dir}${file}`, "utf8");
  const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
  const helpers = [...own.matchAll(/from "(\.{1,2}\/[^"]+)\.js"/g)]
    .map((m) => new URL(`${m[1]!}.ts`, `file://${dir}${folder}`).pathname)
    .filter((path) => path.startsWith(dir) && !DB_HELPERS.has(path.slice(dir.length)));
  return [own, ...helpers.map((path) => readFileSync(path, "utf8"))].join("\n");
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
    ["a new sin_app password", "await setAppRoleLogin(db.prisma, 'other');"],
    ["creating a user", "await db.prisma.$executeRawUnsafe(`CREATE USER t_owner`);"],
    ["a lowercase role statement", "await db.prisma.$executeRawUnsafe(`alter role sin_app nologin`);"],
    ["a membership grant of two roles", "await db.prisma.$executeRawUnsafe(`GRANT pg_monitor, pg_read_all_data TO sin_app`);"],
    ["a database setting", "await db.prisma.$executeRawUnsafe(`ALTER DATABASE mine SET statement_timeout = 5`);"],
    ["a statistics view", "SELECT numbackends FROM pg_stat_database"],
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
    const offenders = files.flatMap((file) => sharedServerProblems(textWithHelpers(file)).map((why) => `${file} — ${why}`));
    expect(offenders).toEqual([]);
  });
});
