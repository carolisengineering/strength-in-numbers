// apps/api/src/db/rls-cli.ts
/**
 * `pnpm --filter @sin/api run db:rls -- status|enable|disable` (Spec 21.1 AC39): shows or switches row-level security on
 * the 19 tables, on the OWNER login. The kill switch for an incident (D12); it leaves the API able to start (D5), and the
 * API warns `rls_disabled` at boot for as long as it stays off. `status` exits 0 even when tables are off, but says so.
 *
 * Exit 1 when the argument is anything else (a typo must never switch RLS), the owner URL is missing, or anything fails.
 * Unlike the other maintenance commands it never reads `.env.owner`: with the variable unset, an `enable` meant for a remote
 * database would switch the local one and print 19 `on`. Locally, pass the URL inline.
 */
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { resolveDatabaseUrl } from "../db.js";
import { redacted } from "./app-role-cli.js";
import { ownerDatabaseUrl } from "./owner-url.js";
import { rlsStatus, rlsTarget, setRls, type RlsTableStatus } from "./rls.js";
import { RLS_TABLES } from "./rls-tables.js";

const USAGE = "usage: db:rls -- status|enable|disable";
const COMMANDS = ["status", "enable", "disable"] as const;
type RlsCommand = (typeof COMMANDS)[number];

export interface RlsIo {
  out(s: string): void;
  err(s: string): void;
}

const processIo: RlsIo = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
};

/** Whether pnpm forwards the `--` depends on how it is run, so one leading `--` is dropped; nothing else is forgiven. */
export function parseRlsArgs(argv: readonly string[]): { ok: true; command: RlsCommand } | { ok: false; error: string } {
  const args = argv[0] === "--" ? argv.slice(1) : argv;
  const command = COMMANDS.find((c) => c === args[0]);
  return args.length === 1 && command !== undefined ? { ok: true, command } : { ok: false, error: USAGE };
}

/**
 * A run that acted on the wrong database must show it. Staging and production can both be `neondb` / `neondb_owner`, so a
 * remote target also shows the host's first label, Neon's endpoint id; the region and domain stay out of the output.
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "db"]);

function describeStatus(status: readonly RlsTableStatus[]): string {
  const width = Math.max(...status.map((s) => s.table.length)) + 2;
  const lines = status.map((s) => `${s.table.padEnd(width)}${s.enabled ? "on" : "OFF"}\n`).join("");
  const off = status.filter((s) => !s.enabled).length;
  return off > 0 ? `${lines}WARNING: ${off} tables have row-level security OFF\n` : lines;
}

export async function main(
  argv: string[],
  env: NodeJS.ProcessEnv,
  deps: { io?: RlsIo; makePrisma?: (url: string) => PrismaClient } = {},
): Promise<number> {
  const io = deps.io ?? processIo;
  const parsed = parseRlsArgs(argv);
  if (!parsed.ok) {
    io.err(`${parsed.error}\n`);
    return 1;
  }
  const owner = ownerDatabaseUrl(env);
  if (!owner.ok) {
    io.err(`${owner.error}\n`);
    return 1;
  }

  const secrets = [owner.url];
  let url: string;
  let where: string;
  try {
    url = resolveDatabaseUrl(owner.url);
    const u = new URL(url);
    where = LOCAL_HOSTS.has(u.hostname) ? "local host" : `remote host ${u.hostname.split(".")[0]}`;
    secrets.push(url, u.password, decodeURIComponent(u.password), u.host, u.hostname);
  } catch (err) {
    io.err(`OWNER_DATABASE_URL rejected: ${redacted(err, secrets)}\n`);
    return 1;
  }

  const owned = deps.makePrisma === undefined;
  let prisma: PrismaClient | undefined;
  try {
    prisma = deps.makePrisma ? deps.makePrisma(url) : new PrismaClient({ datasourceUrl: url });
    const target = await rlsTarget(prisma);
    io.out(`target: database ${target.database}, login ${target.login}, ${where}\n`);
    if (parsed.command === "disable") {
      io.out(`row-level security is being switched OFF for all ${RLS_TABLES.length} tables; switch it back with db:rls -- enable\n`);
    }
    if (parsed.command !== "status") await setRls(prisma, parsed.command === "enable");
    io.out(describeStatus(await rlsStatus(prisma)));
    return 0;
  } catch (err) {
    io.err(`db:rls failed: ${redacted(err, secrets)}\n`);
    return 1;
  } finally {
    if (owned) await prisma?.$disconnect();
  }
}

// Run when invoked directly (`node dist/db/rls-cli.js`, or via scripts/db-rls.ts).
if (process.argv[1] && fileURLToPath(import.meta.url) === realpathSync(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2), process.env);
}
